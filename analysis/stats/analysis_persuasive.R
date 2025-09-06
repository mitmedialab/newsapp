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
    week = factor(as.integer(week)),
    accuracy = as.numeric(accuracy)
  )

# Keep only complete participants
weeks_req  <- levels(df$week)
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

# ---- A) Primary Δ(with−before), Δ(after−before) ----
m_delta <- lm(accuracy ~ time_point*week + factor(participant_id), data = df)

# Robust output
delta_hc2 <- robust_test(m_delta, type="HC2")

# Extract contrasts
delta_tbl <- broom::tidy(m_delta, conf.int = TRUE, conf.level = 0.95,
                         vcov = vcovHC(m_delta, type="HC2"))
write_csv(delta_tbl, file.path(OUT, "primary_deltas_HC2.csv"))

# Durability: Week4 − Week0
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

# ---- B) AFTER-only ----
df_after <- df %>% filter(time_point == "after")
df_after <- df_after %>%
  mutate(week_num = as.numeric(fct_relevel(week, weeks_req)) - 1L)

# AFTER-only levels (W4−W0)
m_after <- lm(accuracy ~ week + factor(participant_id), data = df_after)
after_hc2 <- robust_test(m_after, type="HC2")

after_W4mW0 <- linearHypothesis(m_after, "week4 = 0",
                                vcov. = vcovHC(m_after, type="HC2"))

# Linear trend on AFTER
m_after_trend <- lm(accuracy ~ week_num + factor(participant_id), data = df_after)
after_trend_hc2 <- robust_test(m_after_trend, type="HC2")

sink(file.path(OUT, "after_only_tests.txt"))
cat("AFTER-only W4−W0:\n"); print(after_W4mW0)
cat("\nAFTER-only linear trend:\n"); print(after_trend_hc2)
sink()

# ---- C) Truth-split robustness ----
do_truth_after <- function(label) {
  d <- df_after %>% filter(ground_truth == label)
  if (nrow(d) == 0) return(NULL)
  d <- d %>% mutate(week_num = as.numeric(fct_relevel(week, weeks_req)) - 1L)
  m_lvl <- lm(accuracy ~ week + factor(participant_id), data = d)
  m_trd <- lm(accuracy ~ week_num + factor(participant_id), data = d)
  list(
    level_W4mW0 = linearHypothesis(m_lvl, "week4 = 0",
                                   vcov. = vcovHC(m_lvl, type="HC2")),
    trend = robust_test(m_trd, type="HC2")
  )
}

truth_fake <- do_truth_after("fake")
truth_real <- do_truth_after("real")

saveRDS(list(fake = truth_fake, real = truth_real),
        file.path(OUT, "truth_split_after_only.rds"))

# ---- D) Wilson CIs for AFTER means ----
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


# ---- E) Print truth-split results to .txt ----
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
