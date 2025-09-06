#!/usr/bin/env python3
"""
analysis_pipeline.py

Main analysis:
  - Linear Probability Model (LPM) with participant & item fixed effects + HC2 robust SEs
  - Marginal standardized means by Condition × Week × Phase
  - Contrasts: Δ(with−before), Δ(after−before) within Condition×Week
  - DID per week: (Persuasive − CT) on each Δ
  - Growth tests: (Week 4 − Week 0) on each Δ within condition
  - Optional PDF figures

Truth-specificity splits (FAKE/REAL):
  - Writes an R script that fits Binomial GLMM (lme4) + emmeans contrasts (response scale)
  - Optionally runs it (requires R + lme4 + emmeans installed)

Usage:
  python analysis_pipeline.py --data /path/to/processed_item_level_data.csv --outdir ./outputs --make_pdfs --run_r_glmm
"""

import argparse
import os
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import patsy
import statsmodels.formula.api as smf
import matplotlib.pyplot as plt
from textwrap import dedent
import subprocess


# ---------- Helpers ----------

PHASE_ORDER = ["before", "with", "after"]

def ensure_dirs(path: Path):
    path.mkdir(parents=True, exist_ok=True)

def hc2_lpm_with_fe(df: pd.DataFrame):
    """
    LPM with participant & item fixed effects + HC2 robust SEs.
    Returns fitted model, design_info, params, robust cov.
    """
    formula = "accuracy ~ C(condition)*C(week)*C(time_point) + C(participant_id) + C(imageid)"
    res = smf.ols(formula=formula, data=df).fit(cov_type="HC2")
    di = res.model.data.design_info
    params = res.params.values
    cov = res.cov_params().values
    return res, di, params, cov

def build_mean_design_row(df: pd.DataFrame, design_info, **set_levels):
    """
    Build the MEAN design-row vector for df with certain factor levels set,
    aligned to the fitted model's column order.
    """
    new = df.copy()
    for k, v in set_levels.items():
        new[k] = v
    X = patsy.build_design_matrices([design_info], new)[0]
    return np.asarray(X.mean(axis=0)).ravel()

def est_from_dvec(params, cov, dvec):
    """
    Point estimate, SE, z, two-sided p, 95% CI via delta method under HC2.
    """
    mu = float(dvec @ params)
    se2 = float(dvec @ cov @ dvec)
    se = float(np.sqrt(max(se2, 0.0)))
    z = mu / se if se > 0 else np.nan
    # Normal CDF via erf
    from math import erf, sqrt
    def norm_cdf(x): return 0.5*(1+erf(x/sqrt(2)))
    p = 2*(1 - norm_cdf(abs(z))) if se > 0 else np.nan
    lo, hi = mu - 1.96*se, mu + 1.96*se
    return mu, se, z, p, lo, hi

def marginal_means_and_contrasts(df, design_info, params, cov, outdir: Path):
    """
    Compute adjusted means & within-condition contrasts & DID & growth tests.
    """
    conds = list(df["condition"].cat.categories)
    weeks = list(df["week"].cat.categories)
    phases = list(df["time_point"].cat.categories)

    # Mean rows cache
    mean_rows = {}
    for wk in weeks:
        for cond in conds:
            for ph in phases:
                mean_rows[(wk, cond, ph)] = build_mean_design_row(
                    df, design_info, condition=cond, week=wk, time_point=ph
                )

    # Adjusted means (with CIs)
    means_records = []
    for wk in weeks:
        for cond in conds:
            for ph in phases:
                d = mean_rows[(wk, cond, ph)]
                mu, se, z, p, lo, hi = est_from_dvec(params, cov, d)
                means_records.append({
                    "week": wk, "condition": cond, "time_point": ph,
                    "mean_est": mu, "SE": se, "z": z, "p": p,
                    "95% CI low": lo, "95% CI high": hi
                })
    means_df = pd.DataFrame(means_records)

    # Within-condition contrasts per week
    contrast_records = []
    for wk in weeks:
        for cond in conds:
            d_with = mean_rows[(wk, cond, "with")] - mean_rows[(wk, cond, "before")]
            mu1, se1, z1, p1, lo1, hi1 = est_from_dvec(params, cov, d_with)

            d_after = mean_rows[(wk, cond, "after")] - mean_rows[(wk, cond, "before")]
            mu2, se2, z2, p2, lo2, hi2 = est_from_dvec(params, cov, d_after)

            contrast_records.append({
                "week": wk, "condition": cond,
                "Δ(with−before) est": mu1, "SE": se1, "z": z1, "p": p1,
                "95% CI low": lo1, "95% CI high": hi1,
                "Δ(after−before) est": mu2, "SE.1": se2, "z.1": z2, "p.1": p2,
                "95% CI low.1": lo2, "95% CI high.1": hi2
            })
    contrasts_df = pd.DataFrame(contrast_records)

    # DID per week (Persuasive − CT) on each contrast
    did_records = []
    for wk in weeks:
        d_p_w = mean_rows[(wk, "Persuasive", "with")] - mean_rows[(wk, "Persuasive", "before")]
        d_c_w = mean_rows[(wk, "Critical Thinking", "with")] - mean_rows[(wk, "Critical Thinking", "before")]
        muw, sew, zw, pw, loww, highw = est_from_dvec(params, cov, d_p_w - d_c_w)

        d_p_a = mean_rows[(wk, "Persuasive", "after")] - mean_rows[(wk, "Persuasive", "before")]
        d_c_a = mean_rows[(wk, "Critical Thinking", "after")] - mean_rows[(wk, "Critical Thinking", "before")]
        mua, sea, za, pa, lowa, higha = est_from_dvec(params, cov, d_p_a - d_c_a)

        did_records.append({
            "week": wk,
            "DID (Persuasive−CT) on Δ(with−before) est": muw, "SE": sew, "z": zw, "p": pw,
            "95% CI low": loww, "95% CI high": highw,
            "DID (Persuasive−CT) on Δ(after−before) est": mua, "SE.1": sea, "z.1": za, "p.1": pa,
            "95% CI low.1": lowa, "95% CI high.1": higha
        })
    did_df = pd.DataFrame(did_records)

    # Growth tests: Week 4 − Week 0 on each Δ within condition
    growth_rows = []
    if (("4" in weeks) or (4 in weeks)) and (("0" in weeks) or (0 in weeks)):
        # Coerce to ints safely
        wk_list = [int(w) for w in weeks]
        if 4 in wk_list and 0 in wk_list:
            for cond in conds:
                d_w4_with = mean_rows[(4, cond, "with")] - mean_rows[(4, cond, "before")]
                d_w0_with = mean_rows[(0, cond, "with")] - mean_rows[(0, cond, "before")]
                mu_g1, se_g1, z_g1, p_g1, lo_g1, hi_g1 = est_from_dvec(params, cov, d_w4_with - d_w0_with)

                d_w4_after = mean_rows[(4, cond, "after")] - mean_rows[(4, cond, "before")]
                d_w0_after = mean_rows[(0, cond, "after")] - mean_rows[(0, cond, "before")]
                mu_g2, se_g2, z_g2, p_g2, lo_g2, hi_g2 = est_from_dvec(params, cov, d_w4_after - d_w0_after)

                growth_rows.append({
                    "condition": cond,
                    "Growth (Week4−Week0) on Δ(with−before) est": mu_g1, "SE": se_g1, "z": z_g1, "p": p_g1,
                    "95% CI low": lo_g1, "95% CI high": hi_g1,
                    "Growth (Week4−Week0) on Δ(after−before) est": mu_g2, "SE.1": se_g2, "z.1": z_g2, "p.1": p_g2,
                    "95% CI low.1": lo_g2, "95% CI high.1": hi_g2
                })
    growth_df = pd.DataFrame(growth_rows)

    # Save
    means_df_ = means_df.copy()
    contrasts_df_ = contrasts_df.copy()
    did_df_ = did_df.copy()
    growth_df_ = growth_df.copy()
    for df_ in (means_df_, contrasts_df_, did_df_, growth_df_):
        for c in df_.columns:
            if c not in ["week", "condition", "time_point"]:
                df_[c] = pd.to_numeric(df_[c], errors="coerce").round(4)

    means_df_.to_csv(outdir / "adjusted_means_with_CIs.csv", index=False)
    contrasts_df_.to_csv(outdir / "contrasts_with_pvalues.csv", index=False)
    did_df_.to_csv(outdir / "did_with_pvalues.csv", index=False)
    growth_df_.to_csv(outdir / "growth_tests_week4_minus_week0.csv", index=False)

    return means_df_, contrasts_df_, did_df_, growth_df_

def make_pdf_figures(means_df: pd.DataFrame, contrasts_df: pd.DataFrame, outdir: Path):
    """Matplotlib PDFs; no custom colors/styles; one chart per figure."""
    ensure_dirs(outdir)

    # Phase plots per week
    weeks = sorted({int(w) for w in means_df["week"].unique()})
    for w in weeks:
        sub = means_df[means_df["week"].astype(int) == w].copy()
        phases = PHASE_ORDER
        fig, ax = plt.subplots(figsize=(6,4))
        for cond in sorted(sub["condition"].unique()):
            s = sub[(sub["condition"] == cond) & (sub["time_point"].isin(phases))].copy()
            s = s.set_index("time_point").loc[phases].reset_index()
            y = s["mean_est"].values
            yerr = s["mean_est"].values - s["95% CI low"].values
            ax.errorbar(s["time_point"], y, yerr=yerr, marker="o", capsize=3, label=cond)
        ax.set_ylim(0, 1)
        ax.set_title(f"Adjusted accuracy by phase — Week {w}")
        ax.set_xlabel("Phase")
        ax.set_ylabel("Adjusted accuracy")
        ax.legend()
        plt.tight_layout()
        (outdir / f"fig_means_w{w}.pdf").write_bytes(fig_to_pdf_bytes(fig))
        plt.close(fig)

    # Delta trajectories
    def plot_delta(delta_col, lo_col, hi_col, title, outname):
        sub = contrasts_df[["week","condition", delta_col, lo_col, hi_col]].copy()
        sub["week"] = sub["week"].astype(int)
        fig, ax = plt.subplots(figsize=(6,4))
        for cond in sorted(sub["condition"].unique()):
            s = sub[sub["condition"] == cond].sort_values("week").copy()
            y = s[delta_col].values
            yerr = np.vstack([y - s[lo_col].values, s[hi_col].values - y])
            ax.errorbar(s["week"], y, yerr=yerr, marker="o", capsize=3, label=cond)
        ax.axhline(0, linestyle="--")
        ax.set_title(title)
        ax.set_xlabel("Week")
        ax.set_ylabel("Δ (pp)")
        ax.legend()
        plt.tight_layout()
        (outdir / outname).write_bytes(fig_to_pdf_bytes(fig))
        plt.close(fig)

    # with−before
    plot_delta("Δ(with−before) est", "95% CI low", "95% CI high",
               "In-session uplift Δ(with−before) across weeks", "fig_delta_with_before.pdf")
    # after−before
    plot_delta("Δ(after−before) est", "95% CI low.1", "95% CI high.1",
               "Unassisted transfer Δ(after−before) across weeks", "fig_delta_after_before.pdf")

def fig_to_pdf_bytes(fig):
    """Save a Matplotlib figure to PDF bytes (for cleaner file writes)."""
    import io
    bio = io.BytesIO()
    fig.savefig(bio, format="pdf", dpi=300, bbox_inches="tight")
    return bio.getvalue()

def write_r_glmm_script(outdir: Path):
    """Write R script that runs GLMM + emmeans for MAIN, FAKE-only, REAL-only."""
    r_code = dedent(r'''
        # glmm_emmeans_truth_specificity.R
        suppressPackageStartupMessages({
          library(readr); library(dplyr); library(lme4); library(emmeans); library(tidyr)
        })
        in_path <- file.path("''') + str(outdir.parent) + dedent(r'''","''') + str(outdir.name) + dedent(r'''","processed_item_level_data.csv")
        out_dir <- "''') + str(outdir) + dedent(r'''"
        d <- read_csv(in_path, show_col_types = FALSE) %>%
          filter(is.na(seen) | seen == FALSE) %>%
          mutate(
            time_point = factor(time_point, levels = c("before","with","after")),
            condition  = factor(condition, levels = c("Critical Thinking","Persuasive")),
            week       = factor(week, levels = sort(unique(week))),
            accuracy   = as.integer(accuracy)
          )

        fit_and_emmeans <- function(df, prefix) {
          m <- glmer(accuracy ~ condition * week * time_point +
                       (1 | participant_id) + (1 | imageid),
                     data = df, family = binomial,
                     control = glmerControl(optimizer = "bobyqa"))

          emm_tp <- emmeans(m, ~ time_point | condition * week, type = "response")
          L <- list("with - before" = c(-1, +1, 0),
                    "after - before"= c(-1,  0, +1))
          deltas <- contrast(emm_tp, L, by = c("condition","week"), adjust = "none")
          write_csv(as.data.frame(deltas), file.path(out_dir, paste0(prefix, "_glmm_emmeans_deltas.csv")))

          wb <- deltas %>% subset(contrast == "with - before")
          ab <- deltas %>% subset(contrast == "after - before")
          did_wb <- contrast(wb, method = "revpairwise", by = "week", adjust = "none")  # Persuasive - CT
          did_ab <- contrast(ab, method = "revpairwise", by = "week", adjust = "none")
          did_df <- bind_rows(
            transform(as.data.frame(did_wb), delta = "with - before"),
            transform(as.data.frame(did_ab), delta = "after - before")
          )
          write_csv(did_df, file.path(out_dir, paste0(prefix, "_glmm_emmeans_DID.csv")))
        }

        fit_and_emmeans(d, "MAIN")
        if(any(d$ground_truth == "fake", na.rm = TRUE)) fit_and_emmeans(filter(d, ground_truth == "fake"), "FAKE")
        if(any(d$ground_truth == "real", na.rm = TRUE)) fit_and_emmeans(filter(d, ground_truth == "real"), "REAL")
        cat("Done. Files in:", out_dir, "\n")
    ''')
    r_path = outdir / "glmm_emmeans_truth_specificity.R"
    r_path.write_text(r_code)
    return r_path

def maybe_run_r_glmm(rscript_path: Path, rscript_bin: str):
    """Attempt to run the R script via Rscript."""
    try:
        print(f"[info] Running R GLMM via: {rscript_bin} {rscript_path}")
        proc = subprocess.run([rscript_bin, str(rscript_path)], capture_output=True, text=True, check=False)
        print(proc.stdout)
        if proc.returncode != 0:
            print(proc.stderr, file=sys.stderr)
            print("[warn] Rscript returned non-zero exit code. The script is still saved for manual run.", file=sys.stderr)
    except FileNotFoundError:
        print("[warn] Rscript not found. Skipping execution. You can run the written .R script manually later.")

# ---------- Main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../../data/processed/processed_item_level_data.csv", help="Path to processed_item_level_data.csv")
    ap.add_argument("--outdir", default="./outputs", help="Directory to write outputs (CSVs, PDFs, R script)")
    ap.add_argument("--make_pdfs", action="store_true", help="Also make PDF figures")
    ap.add_argument("--run_r_glmm", action="store_true", help="Run the GLMM + emmeans R script for FAKE/REAL")
    ap.add_argument("--rscript", default="Rscript", help="Path to Rscript binary (if running R)")
    args = ap.parse_args()

    data_path = Path(args.data).expanduser().resolve()
    outdir = Path(args.outdir).expanduser().resolve()
    ensure_dirs(outdir)

    # Load data
    df = pd.read_csv(data_path)
    # Filter and types
    df = df[df["seen"] != True].copy()
    df["accuracy"] = df["accuracy"].astype(float)
    # Order factors
    df["time_point"] = pd.Categorical(df["time_point"], categories=PHASE_ORDER, ordered=True)
    # Condition alphabetically puts "Critical Thinking" as baseline before "Persuasive"
    df["condition"]  = pd.Categorical(df["condition"], categories=sorted(df["condition"].unique()))
    # Keep natural numeric order for week
    df["week"] = pd.Categorical(df["week"], categories=sorted(df["week"].unique()))
    # Save a cleaned copy next to outputs for R to read from same folder if desired
    df_outpath = outdir / "processed_item_level_data.csv"
    df.to_csv(df_outpath, index=False)

    # Cell counts (sanity)
    counts = df.groupby(["condition","week","time_point"]).size().reset_index(name="n")
    counts.to_csv(outdir / "cell_counts.csv", index=False)

    # Main LPM + FE + HC2
    res, di, params, cov = hc2_lpm_with_fe(df)

    means_df, contrasts_df, did_df, growth_df = marginal_means_and_contrasts(df, di, params, cov, outdir)

    # Optional figures (PDF)
    if args.make_pdfs:
        make_pdf_figures(means_df, contrasts_df, outdir)

    # Truth-specificity GLMM (R)
    r_path = write_r_glmm_script(outdir)
    print(f"[info] Wrote R GLMM script to: {r_path}")
    if args.run_r_glmm:
        maybe_run_r_glmm(r_path, args.rscript)

    print("[done] Outputs written to:", outdir)
    print("  - adjusted_means_with_CIs.csv")
    print("  - contrasts_with_pvalues.csv")
    print("  - did_with_pvalues.csv")
    print("  - growth_tests_week4_minus_week0.csv")
    print("  - cell_counts.csv")
    if args.make_pdfs:
        print("  - fig_means_w0.pdf / fig_means_w2.pdf / fig_means_w4.pdf")
        print("  - fig_delta_with_before.pdf / fig_delta_after_before.pdf")
    print("  - glmm_emmeans_truth_specificity.R (MAIN/FAKE/REAL, Δ and DID with exact p-values)")

if __name__ == "__main__":
    main()
