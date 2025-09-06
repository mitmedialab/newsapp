# pp_lpm_pipeline.R
# Linear Probability Model (percentage-point effects) with participant & item FE + HC2.
# Produces: adjusted means, Δ(with−before), Δ(after−before), DID per week, and W4−W0 growth tests.

# ===== 0) Packages =====
pkgs <- c("readr","dplyr","tidyr","stringr","sandwich","lmtest")
to_install <- pkgs[!pkgs %in% rownames(installed.packages())]
if(length(to_install)) install.packages(to_install, repos = "https://cloud.r-project.org")
invisible(lapply(pkgs, library, character.only = TRUE))

# ===== 1) Paths =====
DATA_PATH <- "data/processed/processed_item_level_data.csv"  # change if needed
OUT_DIR   <- "analysis/stats/output"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)


# ===== 2) Load + prep =====
dat <- readr::read_csv(DATA_PATH, show_col_types = FALSE) |>
  dplyr::filter(is.na(seen) | seen == FALSE) |>
  dplyr::mutate(
    accuracy   = as.numeric(accuracy),  # 0/1
    time_point = factor(time_point, levels = c("before","with","after")),
    condition  = factor(condition, levels = c("Critical Thinking","Persuasive")),
    week       = factor(week, levels = sort(unique(week)))
  )

message("N rows: ", nrow(dat))
message("Levels — week: ", paste(levels(dat$week), collapse=", "))

# ===== 3) Fit LPM with FE and HC2 robust VCV =====
form_lpm <- accuracy ~ condition*week*time_point + factor(participant_id) + factor(imageid)
lpm <- lm(form_lpm, data = dat)
Vhc2 <- sandwich::vcovHC(lpm, type = "HC2")  # robust (Eicker–HC2)
beta <- coef(lpm)

# Safety: check V/coef dimension
stopifnot(length(beta) == ncol(model.matrix(lpm)))

# ===== Helpers: design vectors aligned to the fitted model =====
# Builds model matrix using the fitted model's terms/contrasts/xlevels,
# then aligns columns to coef() order before averaging rows.
.make_X <- function(newd) {
  X <- model.matrix(lpm, newd)                     # uses lpm$terms, lpm$contrasts, lpm$xlevels
  X <- X[, names(beta), drop = FALSE]              # enforce exact column order
  X
}
mean_design_vec <- function(data, cond, wk, ph) {
  newd <- data
  newd$condition  <- factor(cond, levels = levels(data$condition))
  newd$week       <- factor(wk,   levels = levels(data$week))
  newd$time_point <- factor(ph,   levels = levels(data$time_point))
  colMeans(.make_X(newd))
}

lin_est <- function(dvec) {
  # dvec is a named numeric vector aligned to beta/Vhc2
  est <- sum(dvec * beta[names(dvec)])
  Vsub <- Vhc2[names(dvec), names(dvec), drop = FALSE]
  se  <- sqrt(drop(t(dvec) %*% Vsub %*% dvec))
  z   <- if (se > 0) est / se else NA_real_
  p   <- if (is.na(z)) NA_real_ else 2*pnorm(-abs(z))
  lo  <- est - 1.96*se
  hi  <- est + 1.96*se
  list(est=est, se=se, z=z, p=p, lo=lo, hi=hi)
}

conds  <- levels(dat$condition)
weeks  <- levels(dat$week)
phases <- levels(dat$time_point)

# ===== 4) Adjusted means (pp) with CIs =====
means_rows <- list()
for (wk in weeks) {
  for (cd in conds) {
    for (ph in phases) {
      dvec <- mean_design_vec(dat, cd, wk, ph)
      res  <- lin_est(dvec)
      means_rows[[length(means_rows)+1]] <- data.frame(
        week = wk, condition = cd, time_point = ph,
        mean_pp = res$est, se = res$se, z = res$z, p = res$p,
        ci_low = res$lo, ci_high = res$hi
      )
    }
  }
}
means_df <- dplyr::bind_rows(means_rows)
readr::write_csv(means_df, file.path(OUT_DIR, "PP_adjusted_means_with_CIs.csv"))

# ===== 5) Within-condition Δ contrasts (with−before, after−before) =====
contr_rows <- list()
for (wk in weeks) {
  for (cd in conds) {
    d_before <- mean_design_vec(dat, cd, wk, "before")
    d_with   <- mean_design_vec(dat, cd, wk, "with")
    d_after  <- mean_design_vec(dat, cd, wk, "after")
    
    res_wb <- lin_est(d_with - d_before)
    res_ab <- lin_est(d_after - d_before)
    
    contr_rows[[length(contr_rows)+1]] <- data.frame(
      week = wk, condition = cd,
      delta_with_minus_before = res_wb$est,
      se_wb = res_wb$se, z_wb = res_wb$z, p_wb = res_wb$p,
      ci_low_wb = res_wb$lo, ci_high_wb = res_wb$hi,
      delta_after_minus_before = res_ab$est,
      se_ab = res_ab$se, z_ab = res_ab$z, p_ab = res_ab$p,
      ci_low_ab = res_ab$lo, ci_high_ab = res_ab$hi
    )
  }
}
contr_df <- dplyr::bind_rows(contr_rows)
readr::write_csv(contr_df, file.path(OUT_DIR, "PP_contrasts_with_pvalues.csv"))

# ===== 6) Between-condition DID per week =====
did_rows <- list()
for (wk in weeks) {
  # Δ for each condition
  d_CT_b <- mean_design_vec(dat, "Critical Thinking", wk, "before")
  d_CT_w <- mean_design_vec(dat, "Critical Thinking", wk, "with")
  d_CT_a <- mean_design_vec(dat, "Critical Thinking", wk, "after")
  
  d_P_b  <- mean_design_vec(dat, "Persuasive", wk, "before")
  d_P_w  <- mean_design_vec(dat, "Persuasive", wk, "with")
  d_P_a  <- mean_design_vec(dat, "Persuasive", wk, "after")
  
  d_delta_wb_CT <- (d_CT_w - d_CT_b)
  d_delta_wb_P  <- (d_P_w  - d_P_b)
  d_delta_ab_CT <- (d_CT_a - d_CT_b)
  d_delta_ab_P  <- (d_P_a  - d_P_b)
  
  # DID = (Persuasive − CT) on each delta
  res_did_wb <- lin_est(d_delta_wb_P - d_delta_wb_CT)
  res_did_ab <- lin_est(d_delta_ab_P - d_delta_ab_CT)
  
  did_rows[[length(did_rows)+1]] <- data.frame(
    week = wk,
    DID_with_minus_before = res_did_wb$est,
    se = res_did_wb$se, z = res_did_wb$z, p = res_did_wb$p,
    ci_low = res_did_wb$lo, ci_high = res_did_wb$hi,
    DID_after_minus_before = res_did_ab$est,
    se2 = res_did_ab$se, z2 = res_did_ab$z, p2 = res_did_ab$p,
    ci_low2 = res_did_ab$lo, ci_high2 = res_did_ab$hi
  )
}
did_df <- dplyr::bind_rows(did_rows)
readr::write_csv(did_df, file.path(OUT_DIR, "PP_DID_with_pvalues.csv"))

# ===== 7) Durability: WeekLast − WeekFirst on each Δ within condition =====
week_first <- weeks[1]
week_last  <- weeks[length(weeks)]

growth_rows <- list()
for (cd in conds) {
  d_b_f <- mean_design_vec(dat, cd, week_first, "before")
  d_w_f <- mean_design_vec(dat, cd, week_first, "with")
  d_a_f <- mean_design_vec(dat, cd, week_first, "after")
  
  d_b_l <- mean_design_vec(dat, cd, week_last, "before")
  d_w_l <- mean_design_vec(dat, cd, week_last, "with")
  d_a_l <- mean_design_vec(dat, cd, week_last, "after")
  
  # Δ at first/last weeks
  d_wb_f <- d_w_f - d_b_f
  d_wb_l <- d_w_l - d_b_l
  d_ab_f <- d_a_f - d_b_f
  d_ab_l <- d_a_l - d_b_l
  
  # Growth = last − first on each Δ
  res_g_wb <- lin_est(d_wb_l - d_wb_f)
  res_g_ab <- lin_est(d_ab_l - d_ab_f)
  
  growth_rows[[length(growth_rows)+1]] <- data.frame(
    condition = cd,
    growth_wlast_minus_wfirst_on_delta_with_before = res_g_wb$est,
    se_wb = res_g_wb$se, z_wb = res_g_wb$z, p_wb = res_g_wb$p,
    ci_low_wb = res_g_wb$lo, ci_high_wb = res_g_wb$hi,
    growth_wlast_minus_wfirst_on_delta_after_before = res_g_ab$est,
    se_ab = res_g_ab$se, z_ab = res_g_ab$z, p_ab = res_g_ab$p,
    ci_low_ab = res_g_ab$lo, ci_high_ab = res_g_ab$hi
  )
}
growth_df <- dplyr::bind_rows(growth_rows)
readr::write_csv(growth_df, file.path(OUT_DIR, "PP_growth_Wlast_minus_Wfirst.csv"))

message("Done. Files written to: ", OUT_DIR)
