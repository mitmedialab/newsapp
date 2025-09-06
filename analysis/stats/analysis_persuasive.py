# Re-run the full block after kernel reset (packaged into a function to avoid another reset)
import pandas as pd
import numpy as np
import patsy
import statsmodels.api as sm
import statsmodels.formula.api as smf
import matplotlib.pyplot as plt
import io
import os

def run_final_analyses():
    DATA = "../../data/processed/processed_item_level_data.csv"
    OUT_PREFIX = "./final_persuasive/"
    os.makedirs(os.path.dirname(OUT_PREFIX), exist_ok=True)

    df = pd.read_csv(DATA)
    df = df[(df["condition"] == "Persuasive")].copy()
    if "seen" in df.columns:
        df = df[df["seen"] != True].copy()
    assert "participant_id" in df.columns
    item_col = None
    for cand in ["imageid","image_id","item_id","headline_image_id","stimulus_id"]:
        if cand in df.columns:
            item_col = cand; break
    if item_col is None:
        raise RuntimeError("Could not find an item id column.")
    assert "accuracy" in df.columns
    df["accuracy"] = df["accuracy"].astype(float)
    df["time_point"] = pd.Categorical(df["time_point"], categories=["before","with","after"], ordered=True)
    df["week"] = df["week"].astype(int)
    df["week"] = pd.Categorical(df["week"], categories=sorted(df["week"].unique()))
    weeks_req = list(df["week"].cat.categories)
    phases_req = {"before","with","after"}
    def is_complete(g):
        if set(g["week"].unique()) != set(weeks_req): return False
        for wk in weeks_req:
            sub = g[g["week"] == wk]
            if not phases_req.issubset(set(sub["time_point"])): return False
        return True
    complete_ids = [pid for pid, g in df.groupby("participant_id") if is_complete(g)]
    df = df[df["participant_id"].isin(complete_ids)].copy()

    # Models
    formula = f"accuracy ~ C(week)*C(time_point) + C(participant_id) + C({item_col})"
    lpm = smf.ols(formula, data=df).fit(cov_type="HC2")
    glm = smf.glm(formula=formula, data=df, family=sm.families.Binomial()).fit(cov_type="HC2")

    # Helpers
    PHASE_ORDER = ["before","with","after"]
    def design_mean_vector(di, base_df, **set_levels):
        new = base_df.copy()
        for k,v in set_levels.items(): new[k] = v
        X = patsy.build_design_matrices([di], new)[0]
        return np.asarray(X.mean(axis=0)).ravel()
    def est_from_dvec(params, cov, dvec):
        mu = float(dvec @ params); se2 = float(dvec @ cov @ dvec)
        se = float(np.sqrt(max(se2, 0.0))); z = mu / se if se>0 else np.nan
        from math import erf, sqrt
        def cdf(x): return 0.5*(1+erf(x/sqrt(2)))
        p = 2*(1 - cdf(abs(z))) if se>0 else np.nan
        lo, hi = mu - 1.96*se, mu + 1.96*se
        return mu, se, z, p, lo, hi
    # LPM means
    di_lpm = lpm.model.data.design_info
    params_lpm = lpm.params.values; cov_lpm = lpm.cov_params().values
    lpm_means = []
    for wk in df["week"].cat.categories:
        for ph in PHASE_ORDER:
            d = design_mean_vector(di_lpm, df, week=wk, time_point=ph)
            mu, se, z, p, lo, hi = est_from_dvec(params_lpm, cov_lpm, d)
            lpm_means.append({"week": int(wk), "time_point": ph, "mean_est": mu, "SE": se, "z": z, "p": p, "CI_lo": lo, "CI_hi": hi})
    lpm_means = pd.DataFrame(lpm_means)

    # Contrasts & growth from LPM
    def contrasts_from_lpm():
        rows = []
        for wk in df["week"].cat.categories:
            d_with  = design_mean_vector(di_lpm, df, week=wk, time_point="with")
            d_before= design_mean_vector(di_lpm, df, week=wk, time_point="before")
            d_after = design_mean_vector(di_lpm, df, week=wk, time_point="after")
            for name, d in [("Δ(with−before)", d_with - d_before),
                            ("Δ(after−before)", d_after - d_before)]:
                mu, se, z, p, lo, hi = est_from_dvec(params_lpm, cov_lpm, d)
                rows.append({"week": int(wk), "contrast": name, "est": mu, "SE": se, "z": z, "p": p, "CI_lo": lo, "CI_hi": hi})
        return pd.DataFrame(rows)
    lpm_contrasts = contrasts_from_lpm()

    def growth_from_lpm():
        di = di_lpm; params = params_lpm; cov = cov_lpm
        weeks = list(df["week"].cat.categories); w0, wN = int(weeks[0]), int(weeks[-1])
        vecs = {}
        for wk in weeks:
            d_with  = design_mean_vector(di, df, week=wk, time_point="with")
            d_before= design_mean_vector(di, df, week=wk, time_point="before")
            d_after = design_mean_vector(di, df, week=wk, time_point="after")
            vecs[int(wk)] = {"with_before": d_with - d_before, "after_before": d_after - d_before}
        out = []
        for label, key in [("Δ(with−before)", "with_before"), ("Δ(after−before)", "after_before")]:
            d = vecs[wN][key] - vecs[w0][key]
            mu, se, z, p, lo, hi = est_from_dvec(params, cov, d)
            out.append({"contrast_growth": f"{label} (W{wN}−W{w0})", "est": mu, "SE": se, "z": z, "p": p, "CI_lo": lo, "CI_hi": hi})
        return pd.DataFrame(out)
    lpm_growth = growth_from_lpm()

    # GLM bounded means
    di_glm = glm.model.data.design_info
    params_glm = glm.params.values; cov_glm = glm.cov_params().values
    glm_means = []
    for wk in df["week"].cat.categories:
        for ph in PHASE_ORDER:
            d = design_mean_vector(di_glm, df, week=wk, time_point=ph)
            eta, se_eta, *_ = est_from_dvec(params_glm, cov_glm, d)
            p_hat = 1/(1+np.exp(-eta)); dp = p_hat*(1-p_hat)
            se_p = abs(dp) * se_eta
            lo, hi = p_hat - 1.96*se_p, p_hat + 1.96*se_p
            glm_means.append({"week": int(wk), "time_point": ph, "prob_est": p_hat, "SE": se_p, "CI_lo": lo, "CI_hi": hi})
    glm_means = pd.DataFrame(glm_means)

    # Save CSVs
    lpm_means.round(4).to_csv(f"{OUT_PREFIX}_LPM_adjusted_means.csv", index=False)
    lpm_contrasts.round(4).to_csv(f"{OUT_PREFIX}_LPM_contrasts.csv", index=False)
    lpm_growth.round(4).to_csv(f"{OUT_PREFIX}_LPM_growth.csv", index=False)
    glm_means.round(4).to_csv(f"{OUT_PREFIX}_GLM_means_bounded.csv", index=False)

    # Figures
    def fig_to_pdf_bytes(fig):
        bio = io.BytesIO(); fig.savefig(bio, format="pdf", dpi=300, bbox_inches="tight"); return bio.getvalue()
    PHASE_ORDER = ["before","with","after"]
    for wk in df["week"].cat.categories:
        sub = glm_means[glm_means["week"] == int(wk)]
        fig, ax = plt.subplots(figsize=(6,4))
        s = sub.set_index("time_point").loc[PHASE_ORDER].reset_index()
        y = s["prob_est"].values; yerr = y - s["CI_lo"].values
        ax.errorbar(s["time_point"], y, yerr=yerr, marker="o", capsize=3, label="Persuasive")
        ax.set_ylim(0, 1); ax.set_title(f"Persuasive — Adjusted accuracy by phase (Week {wk})")
        ax.set_xlabel("Phase"); ax.set_ylabel("Adjusted accuracy (GLM)"); ax.legend(); plt.tight_layout()
        pdf_path = f"{OUT_PREFIX}_fig_means_w{wk}.pdf"
        with open(pdf_path, "wb") as f: f.write(fig_to_pdf_bytes(fig))
        plt.close(fig)

    def plot_delta(delta_name, out_name):
        sub = lpm_contrasts[lpm_contrasts["contrast"]==delta_name].copy().sort_values("week")
        fig, ax = plt.subplots(figsize=(6,4))
        x = sub["week"].astype(int).values; y = sub["est"].values
        ylo = sub["CI_lo"].values; yhi = sub["CI_hi"].values
        yerr = np.vstack([y - ylo, yhi - y])
        ax.errorbar(x, y, yerr=yerr, marker="o", capsize=3, label="Persuasive")
        ax.axhline(0, linestyle="--"); ax.set_title(f"{delta_name} across weeks (Persuasive)")
        ax.set_xlabel("Week"); ax.set_ylabel("Δ (percentage points)"); ax.legend(); plt.tight_layout()
        pdf_path = f"{OUT_PREFIX}_{out_name}.pdf"
        with open(pdf_path, "wb") as f: f.write(fig_to_pdf_bytes(fig))
        plt.close(fig)

    plot_delta("Δ(with−before)", "fig_delta_with_before")
    plot_delta("Δ(after−before)", "fig_delta_after_before")

    # Display to user
    print("Persuasive-only LPM — adjusted means (unbounded; for Δ math)", lpm_means)
    print("Persuasive-only LPM — within-week contrasts (Δ)", lpm_contrasts)
    print("Persuasive-only LPM — durability (Week4−Week0) on Δ", lpm_growth)
    print("Persuasive-only GLM — adjusted means (bounded)", glm_means)

    # Summary
    def pp(x): return f"{x*100:.1f} pp"
    lines = []
    lines.append("FINAL (Persuasive-only, accuracy as primary)\n")
    for cname in ["Δ(with−before)", "Δ(after−before)"]:
        sub = lpm_contrasts[lpm_contrasts["contrast"]==cname].copy().sort_values("week")
        lines.append(cname + ":")
        for _, r in sub.iterrows():
            lines.append(f"  Week {int(r['week'])}: {pp(r['est'])} (p={r['p']:.3f})  CI[{pp(r['CI_lo'])}, {pp(r['CI_hi'])}]")
        lines.append("")
    lines.append("Durability (Week4−Week0 on Δ):")
    for _, r in lpm_growth.iterrows():
        lines.append(f"  {r['contrast_growth']}: {pp(r['est'])} (p={r['p']:.3f})  CI[{pp(r['CI_lo'])}, {pp(r['CI_hi'])}]")
    summary_text = "\n".join(lines)
    with open(f"{OUT_PREFIX}_summary.txt","w") as f: f.write(summary_text)
    print(summary_text)


    # AFTER-only Week4 − Week0 contrast (no deltas), with participant & item FE
    def after_only_W4_minus_W0(lpm_res, dat):
        di   = lpm_res.model.data.design_info
        beta = lpm_res.params.values
        V    = lpm_res.cov_params().values

        weeks = list(dat["week"].cat.categories)
        w0, wN = int(weeks[0]), int(weeks[-1])

        d_after_w0 = design_mean_vector(di, dat, week=w0, time_point="after")
        d_after_wN = design_mean_vector(di, dat, week=wN, time_point="after")

        d = d_after_wN - d_after_w0
        mu, se, z, p, lo, hi = est_from_dvec(beta, V, d)
        return pd.DataFrame([{
            "contrast": "AFTER level (W4−W0)",
            "est": mu, "SE": se, "z": z, "p": p, "CI_lo": lo, "CI_hi": hi
        }])

    after_level_growth = after_only_W4_minus_W0(lpm, df)
    print(after_level_growth)
    # Optional: save
    after_level_growth.round(4).to_csv(f"{OUT_PREFIX}_AFTER_only_growth_W4_minus_W0.csv", index=False)
    


    return {
        "LPM_means_csv": f"{OUT_PREFIX}_LPM_adjusted_means.csv",
        "LPM_contrasts_csv": f"{OUT_PREFIX}_LPM_contrasts.csv",
        "LPM_growth_csv": f"{OUT_PREFIX}_LPM_growth.csv",
        "GLM_means_bounded_csv": f"{OUT_PREFIX}_GLM_means_bounded.csv",
        "FIG_means_w0_pdf": f"{OUT_PREFIX}_fig_means_w0.pdf",
        "FIG_means_w2_pdf": f"{OUT_PREFIX}_fig_means_w2.pdf",
        "FIG_means_w4_pdf": f"{OUT_PREFIX}_fig_means_w4.pdf",
        "FIG_delta_with_before_pdf": f"{OUT_PREFIX}_fig_delta_with_before.pdf",
        "FIG_delta_after_before_pdf": f"{OUT_PREFIX}_fig_delta_after_before.pdf",
        "AFTER_only_growth_W4_minus_W0_csv": f"{OUT_PREFIX}_AFTER_only_growth_W4_minus_W0.csv",
        "SUMMARY_txt": f"{OUT_PREFIX}_summary.txt",
    }



outputs = run_final_analyses()
print(outputs)
