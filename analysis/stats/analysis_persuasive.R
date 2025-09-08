# ---- Libraries ----
library(dplyr)
library(tidyr)
library(readr)
library(forcats)
library(sandwich)
library(lmtest)
library(car)
library(binom)
library(ggplot2)
library(broom)
library(emmeans)
library(tibble)

# ---- Paths ----
DATA <- "data/processed/processed_item_level_data.csv"  # <- UPDATE
OUT  <- "analysis/stats/final_persuasive_outputs_R"
dir.create(OUT, showWarnings = FALSE, recursive = TRUE)

# ---- Load & prep ----
df <- read_csv(DATA, show_col_types = FALSE) %>%
  filter(condition == "Persuasive") %>%
  { if ("seen" %in% names(.)) filter(., seen != TRUE) else . } %>%
  mutate(
    time_point = factor(time_point, levels = c("before","with","after")),
    # Normalize week to factor with explicit order 0,2,4
    week = factor(as.character(as.integer(week)), levels = c("0","2","4")),
    accuracy = as.numeric(accuracy)
  )

# (Optional) If attention-check columns exist upstream, keep participants who
# did not fail more than one attention check. This block is a no-op if absent.
if (all(c("attn_fails","participant_id") %in% names(df))) {
  ok_ids <- df %>%
    group_by(participant_id) %>%
    summarize(attn_fails_max = max(attn_fails, na.rm = TRUE), .groups = "drop") %>%
    filter(attn_fails_max <= 1) %>%
    pull(participant_id)
  df <- df %>% filter(participant_id %in% ok_ids)
}

# Keep only complete participants (all three phases at each of 0/2/4)
weeks_req  <- levels(df$week)                 # c("0","2","4")
phases_req <- c("before","with","after")
complete_ids <- df %>%
  group_by(participant_id) %>%
  filter(all(weeks_req %in% week) &
           all(sapply(weeks_req, function(w)
             all(phases_req %in% time_point[week==w])))) %>%
  pull(participant_id) %>%
  unique()
df <- df %>% filter(participant_id %in% complete_ids)

# ---- Helper: robust coeftest ----
robust_test <- function(model, type="HC2") {
  coeftest(model, vcov = vcovHC(model, type = type))
}

# ======================================================================
# A) Primary Δ(with−before), Δ(after−before): participant-FE LPM with HC2
# ======================================================================
m_delta <- lm(accuracy ~ time_point * week + factor(participant_id), data = df)

# Robust output (table of coefficients with HC2 CIs) -- original artifact
delta_tbl <- broom::tidy(m_delta, conf.int = TRUE, conf.level = 0.95,
                         vcov = vcovHC(m_delta, type="HC2"))
write_csv(delta_tbl, file.path(OUT, "primary_deltas_HC2.csv"))

# ---- A1) Durability: Week4 − Week0 (original artifacts) ----
grow_with <- linearHypothesis(
  m_delta,
  "time_pointwith:week4 = time_pointwith",
  vcov. = vcovHC(m_delta, type="HC2")
)
grow_after <- linearHypothesis(
  m_delta,
  "time_pointafter:week4 = time_pointafter",
  vcov. = vcovHC(m_delta, type="HC2")
)

sink(file.path(OUT, "durability_tests.txt"))
cat("Δ(with−before) W4−W0\n"); print(grow_with)
cat("\nΔ(after−before) W4−W0\n"); print(grow_after)
sink()

# ---- A1b) NEW: Planned within-week contrasts with HC2 CIs (for text) ----
# This produces Δ(with−before) and Δ(after−before) for Week 0, 2, 4
Vhc2 <- sandwich::vcovHC(m_delta, type = "HC2")
em_tp_by_w <- emmeans::emmeans(m_delta, ~ time_point | week, vcov = Vhc2)

ct_list <- list(
  `Δ(with−before)`  = c(-1, +1, 0),  # before, with, after
  `Δ(after−before)` = c(-1, 0, +1)
)
contr_by_w <- emmeans::contrast(em_tp_by_w, method = ct_list, by = "week")

ctr_sum <- summary(contr_by_w, infer = c(TRUE, TRUE), level = 0.95, adjust = "none")

ctr_out <- ctr_sum %>%
  mutate(
    estimate_pp = 100 * estimate,
    lower_pp    = 100 * lower.CL,
    upper_pp    = 100 * upper.CL,
    SE_pp       = 100 * SE
  ) %>%
  select(week, contrast, estimate_pp, lower_pp, upper_pp, SE_pp, df, t.ratio, p.value)

write_csv(ctr_out, file.path(OUT, "planned_contrasts_by_week_HC2.csv"))

# =========================================
# B) AFTER-only (levels across weeks) tests
# =========================================
df_after <- df %>% filter(time_point == "after") %>%
  mutate(week_num = as.numeric(forcats::fct_relevel(week, weeks_req)) - 1L)

# AFTER-only levels (W4−W0; Week0 is baseline)
m_after <- lm(accuracy ~ week + factor(participant_id), data = df_after)
after_hc2 <- robust_test(m_after, type="HC2")
after_W4mW0 <- linearHypothesis(m_after, "week4 = 0",
                                vcov. = vcovHC(m_after, type="HC2"))

# Linear trend on AFTER (per two-week step)
m_after_trend <- lm(accuracy ~ week_num + factor(participant_id), data = df_after)
after_trend_hc2 <- robust_test(m_after_trend, type="HC2")

sink(file.path(OUT, "after_only_tests.txt"))
cat("AFTER-only W4−W0:\n"); print(after_W4mW0)
cat("\nAFTER-only linear trend:\n"); print(after_trend_hc2)
sink()

# ---- B1) NEW: Export pp-sized effects for AFTER-only (for text) ----
after_eff <- broom::tidy(m_after, conf.int = TRUE, vcov = vcovHC(m_after, type="HC2")) %>%
  filter(term %in% c("week2","week4")) %>%
  transmute(term,
            estimate_pp = 100*estimate,
            lower_pp = 100*conf.low,
            upper_pp = 100*conf.high)
write_csv(after_eff, file.path(OUT, "after_only_level_diffs_pp.csv"))

trend_pp <- broom::tidy(m_after_trend, conf.int = TRUE, vcov = vcovHC(m_after_trend, type="HC2")) %>%
  filter(term=="week_num") %>%
  mutate(estimate_pp_per_step = 100*estimate,
         lower_pp_per_step = 100*conf.low,
         upper_pp_per_step = 100*conf.high) %>%
  select(term, estimate_pp_per_step, lower_pp_per_step, upper_pp_per_step, p.value)
write_csv(trend_pp, file.path(OUT, "after_only_trend_pp.csv"))

# ================================================
# C) Truth-split robustness (AFTER-only, FAKE/REAL)
# ================================================
do_truth_after <- function(label) {
  d <- df_after %>% filter(ground_truth == label)
  if (nrow(d) == 0) return(NULL)
  d <- d %>% mutate(week_num = as.numeric(forcats::fct_relevel(week, weeks_req)) - 1L)
  m_lvl <- lm(accuracy ~ week + factor(participant_id), data = d)
  m_trd <- lm(accuracy ~ week_num + factor(participant_id), data = d)
  list(
    level_W4mW0 = linearHypothesis(m_lvl, "week4 = 0",
                                   vcov. = vcovHC(m_lvl, type="HC2")),
    trend = robust_test(m_trd, type="HC2"),
    trend_tidy = broom::tidy(m_trd, conf.int = TRUE, vcov = vcovHC(m_trd, type="HC2"))
  )
}

truth_fake <- do_truth_after("fake")
truth_real <- do_truth_after("real")

saveRDS(list(fake = truth_fake, real = truth_real),
        file.path(OUT, "truth_split_after_only.rds"))

# ---- C1) Print tests to .txt (original artifact) ----
sink(file.path(OUT, "truth_split_after_only.txt"))
cat("=== AFTER-only truth-split robustness ===\n\n")

if (!is.null(truth_fake)) {
  cat("FAKE items:\n")
  print(truth_fake$level_W4mW0)   # Week4 − Week0 test
  cat("\nLinear trend:\n")
  print(truth_fake$trend)
  cat("\n----------------------\n\n")
}

if (!is.null(truth_real)) {
  cat("REAL items:\n")
  print(truth_real$level_W4mW0)   # Week4 − Week0 test
  cat("\nLinear trend:\n")
  print(truth_real$trend)
  cat("\n----------------------\n\n")
}
sink()

# ---- C2) NEW: Export truth-split slope estimates in pp per step (for text) ----
truth_slopes <- bind_rows(
  if (!is.null(truth_fake)) {
    truth_fake$trend_tidy %>% filter(term=="week_num") %>%
      transmute(label = "FAKE",
                slope_pp_per_step = 100*estimate,
                lower_pp = 100*conf.low,
                upper_pp = 100*conf.high,
                p_value = p.value)
  },
  if (!is.null(truth_real)) {
    truth_real$trend_tidy %>% filter(term=="week_num") %>%
      transmute(label = "REAL",
                slope_pp_per_step = 100*estimate,
                lower_pp = 100*conf.low,
                upper_pp = 100*conf.high,
                p_value = p.value)
  }
)
if (nrow(truth_slopes) > 0) {
  write_csv(truth_slopes, file.path(OUT, "truth_split_trends_pp.csv"))
}

# ==========================================
# D) Wilson CIs for AFTER means (for figure)
# ==========================================
after_counts <- df_after %>%
  group_by(week) %>%
  summarise(success = sum(accuracy==1),
            n = n(),
            .groups="drop") %>%
  mutate(prop = success/n)

ci <- binom.confint(after_counts$success, after_counts$n, method="wilson")
after_plot_df <- bind_cols(after_counts, as_tibble(ci)[,c("lower","upper")]) %>%
  rename(ci_lo = lower, ci_hi = upper)

write_csv(after_plot_df, file.path(OUT, "after_means_wilson.csv"))

p <- ggplot(after_plot_df, aes(x = as.numeric(as.character(week)), y = prop)) +
  geom_errorbar(aes(ymin = ci_lo, ymax = ci_hi), width = 0.3) +
  geom_point(size = 2) + geom_line() +
  coord_cartesian(ylim = c(0,1)) +
  labs(x = "Week", y = "Unaided accuracy (AFTER)",
       title = "Persuasive — AFTER accuracy by week (Wilson 95% CI)") +
  theme_minimal(base_size = 11)

ggsave(file.path(OUT,"fig_after_means_wilson.pdf"), p, width=6, height=4)

# ---- E) (Optional) Console summary for quick sanity check ----
cat("\nSaved outputs:\n",
    "- primary_deltas_HC2.csv\n",
    "- planned_contrasts_by_week_HC2.csv  <-- use for Δ(with−before) & Δ(after−before) by week + CIs\n",
    "- durability_tests.txt\n",
    "- after_only_tests.txt\n",
    "- after_only_level_diffs_pp.csv\n",
    "- after_only_trend_pp.csv\n",
    "- truth_split_after_only.txt\n",
    "- truth_split_trends_pp.csv\n",
    "- after_means_wilson.csv\n")
