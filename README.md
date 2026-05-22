# Dialogues with AI and Misinformation Discernment

This repository contains code, processed data artifacts, analysis scripts, and study interface materials for the CHI 2026 paper:

**Dialogues with AI Reduce Beliefs in Misinformation but Build No Lasting Discernment Skills**  
Anku Rani, Valdemar Danry, Paul Pu Liang, Andrew Lippman, Pattie Maes  
DOI: https://doi.org/10.1145/3772318.3790656

## Project Summary

This project investigates whether conversational AI helps people *learn* to detect misinformation, or mainly improves in-the-moment performance while assistance is available.

Across a month-long longitudinal study, participants completed repeated sessions with three tasks:
- **Before AI:** independent authenticity judgments
- **With AI:** judgments supported by dialogue with an AI assistant
- **After AI:** independent judgments on new items right after AI assistance (when the AI was removed).

The paper reports a central pattern: strong immediate gains during AI-assisted interaction, but no durable improvement in independent discernment and a decline in post-assistance unassisted performance over time.

## Repository Contents

```text
.
├── analysis/
│   ├── preprocess.ipynb
│   ├── conversation_analysis.ipynb
│   ├── plot_llm_as_judge.ipynb
│   ├── classifiers_llm/
│   │   ├── llm_as_a_judge.py
│   │   └── classifier_prompts.py
│   ├── nlp/
│   └── stats/
│       ├── analysis.R
│       ├── analysis_persuasive.R
│       └── final_persuasive_outputs_R/
├── data/
│   ├── process_data.py
│   ├── raw/
│   └── processed/
├── study_interface/
│   ├── README.md
│   ├── Dialogues with AI app/user-interface/
│   └── Phase wise Data/
├── requirements.txt
└── LICENSE
```

### Folder Guide

- `data/raw/`: raw study exports and source tabular files
- `data/processed/`: processed analysis-ready datasets and derived outputs
- `analysis/stats/`: R scripts for primary inferential analyses and robustness outputs
- `analysis/classifiers_llm/`: LLM-as-a-judge pipeline for conversation strategy labeling
- `analysis/*.ipynb`: notebook-based preprocessing, exploration, and plotting
- `study_interface/`: participant-facing web app and phase-wise media/data assets

## Reproducibility Setup

### 1) Python Environment

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`requirements.txt` includes core dependencies used in this repository (OpenAI SDK, dotenv, pandas/numpy, Jupyter, matplotlib/seaborn).

### 2) R Environment

The R scripts install missing CRAN packages automatically on first run.

## Reproducing Core Analyses

### A) Persuasive-condition primary analyses (main paper outputs)

```bash
Rscript analysis/stats/analysis_persuasive.R
```

Primary output directory:
- `analysis/stats/final_persuasive_outputs_R/`

This script produces:
- participant fixed-effects linear probability model results with HC2 robust errors
- planned within-week contrasts (`with-before`, `after-before`)
- trend and week-difference tests for before-only and after-only outcomes
- truth-split robustness summaries
- Wilson interval summaries and a figure-ready PDF

### B) Two-condition comparison pipeline

```bash
Rscript analysis/stats/analysis.R
```

Output directory:
- `analysis/stats/output/`

This script estimates condition-by-week-by-phase effects and exports adjusted means, contrasts, difference-in-differences, and growth tests.

### C) LLM-as-a-judge conversation classification

1. Create a root `.env` file with your OpenAI key:

```bash
OPENAI_API_KEY=your_key_here
```

2. Run the classifier:

```bash
python analysis/classifiers_llm/llm_as_a_judge.py \
  --data data/processed/conversations \
  --classifiers all \
  --output data/processed/llm_as_judge_results
```

The classifier reconstructs conversations from phase CSV files and labels strategy categories defined in `analysis/classifiers_llm/classifier_prompts.py`.

### D) Data processing utility

```bash
python data/process_data.py
```

This utility merges and harmonizes phase-level files and writes a merged CSV under `data/processed/`.

### E) Notebooks

Use Jupyter to run exploratory and plotting notebooks:

```bash
jupyter notebook
```

Key notebooks are in:
- `analysis/preprocess.ipynb`
- `analysis/conversation_analysis.ipynb`
- `analysis/plot_llm_as_judge.ipynb`

## Study Interface (Web App)

The participant interface is under:
- `study_interface/Dialogues with AI app/user-interface/`

Run locally:

```bash
cd "study_interface/Dialogues with AI app/user-interface"
npm install
npm start
```

Build/test:

```bash
npm run build
npm test
```

Additional details are documented in `study_interface/README.md`.

## Data and Ethics Notes

- This repository is intended for research transparency and replication.
- Use the data in accordance with institutional, legal, and ethical requirements.

## Citation

If you use this repository, please cite the paper:

```bibtex
@inproceedings{rani2026dialogues,
  title     = {Dialogues with AI Reduce Beliefs in Misinformation but Build No Lasting Discernment Skills},
  author    = {Rani, Anku and Danry, Valdemar and Liang, Paul Pu and Lippman, Andrew and Maes, Pattie},
  booktitle = {Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems (CHI '26)},
  year      = {2026},
  articleno = {792},
  pages     = {1--26},
  doi       = {10.1145/3772318.3790656},
  url       = {https://doi.org/10.1145/3772318.3790656}
}
```

## License

See `LICENSE` for repository licensing details.
