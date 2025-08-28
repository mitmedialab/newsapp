#!/usr/bin/env python3
"""
Data Processing Script for News Veracity and Conversational AI Study
Merges Phase 1 (Week 0) and Phase 2 (Week 1) data while preserving all columns.
"""

import pandas as pd
import numpy as np
import os
from pathlib import Path

def load_and_prepare_data():
    """Load and prepare all data files for merging."""
    
    print("Loading data files...")
    
    # Load Phase 1 data (Week 0)
    phase1_path = "raw/Phase1_final_data.csv"
    phase1 = pd.read_csv(phase1_path)
    print(f"Phase 1 loaded: {phase1.shape[0]} rows, {phase1.shape[1]} columns")
    
    # Load Phase 2 data (Week 1)
    phase2_c1_path = "raw/Phase2_condition_1_rating.csv"
    phase2_c2_path = "raw/Phase2_condition_2_rating.csv"
    
    phase2_c1 = pd.read_csv(phase2_c1_path)
    phase2_c2 = pd.read_csv(phase2_c2_path)
    
    print(f"Phase 2 Condition 1 loaded: {phase2_c1.shape[0]} rows, {phase2_c1.shape[1]} columns")
    print(f"Phase 2 Condition 2 loaded: {phase2_c2.shape[0]} rows, {phase2_c2.shape[1]} columns")
    
    return phase1, phase2_c1, phase2_c2

def clean_phase2_data(phase2_c1, phase2_c2):
    """Clean Phase 2 data files to match Phase 1 structure."""
    
    print("\nCleaning Phase 2 data...")
    
    # Drop the unnamed index column from Phase 2 files
    if 'Unnamed: 0' in phase2_c1.columns:
        phase2_c1 = phase2_c1.drop('Unnamed: 0', axis=1)
        print("Dropped 'Unnamed: 0' column from Phase 2 Condition 1")
    
    if 'Unnamed: 0' in phase2_c2.columns:
        phase2_c2 = phase2_c2.drop('Unnamed: 0', axis=1)
        print("Dropped 'Unnamed: 0' column from Phase 2 Condition 2")
    
    # Rename 'with_AI_seen_before' to 'after_AI_seen_before' to match Phase 1
    if 'with_AI_seen_before' in phase2_c1.columns:
        phase2_c1 = phase2_c1.rename(columns={'with_AI_seen_before': 'after_AI_seen_before'})
        print("Renamed 'with_AI_seen_before' to 'after_AI_seen_before' in Phase 2 Condition 1")
    
    if 'with_AI_seen_before' in phase2_c2.columns:
        phase2_c2 = phase2_c2.rename(columns={'with_AI_seen_before': 'after_AI_seen_before'})
        print("Renamed 'with_AI_seen_before' to 'after_AI_seen_before' in Phase 2 Condition 2")
    
    # Add 'final rating submitted' column to Phase 2 files (not present in original)
    # This appears to be a confidence rating, so we'll fill with NaN for now
    if 'final rating submitted' not in phase2_c1.columns:
        phase2_c1['final rating submitted'] = np.nan
        print("Added 'final rating submitted' column to Phase 2 Condition 1 (filled with NaN)")
    
    if 'final rating submitted' not in phase2_c2.columns:
        phase2_c2['final rating submitted'] = np.nan
        print("Added 'final rating submitted' column to Phase 2 Condition 2 (filled with NaN)")
    
    return phase2_c1, phase2_c2

def add_phase_identifiers(phase1, phase2_c1, phase2_c2):
    """Add phase and week identifiers to distinguish data sources."""
    
    print("\nAdding phase identifiers...")
    
    # Add phase column
    phase1['phase'] = 'Phase1'
    phase2_c1['phase'] = 'Phase2'
    phase2_c2['phase'] = 'Phase2'
    
    # Add week column
    phase1['week'] = 0
    phase2_c1['week'] = 2
    phase2_c2['week'] = 2
    
    print("Added 'phase' and 'week' columns to all datasets")
    
    return phase1, phase2_c1, phase2_c2

def verify_column_consistency(phase1, phase2_c1, phase2_c2):
    """Verify that all datasets have consistent columns before merging."""
    
    print("\nVerifying column consistency...")
    
    phase1_cols = set(phase1.columns)
    phase2_c1_cols = set(phase2_c1.columns)
    phase2_c2_cols = set(phase2_c2.columns)
    
    # Check if all datasets have the same columns
    if phase1_cols == phase2_c1_cols == phase2_c2_cols:
        print("✅ All datasets have consistent columns")
        return True
    else:
        print("❌ Column inconsistency detected!")
        print(f"Phase 1 columns: {sorted(phase1_cols)}")
        print(f"Phase 2 C1 columns: {sorted(phase2_c1_cols)}")
        print(f"Phase 2 C2 columns: {sorted(phase2_c2_cols)}")
        
        print(f"Phase 1 only: {phase1_cols - phase2_c1_cols - phase2_c2_cols}")
        print(f"Phase 2 C1 only: {phase2_c1_cols - phase1_cols - phase2_c2_cols}")
        print(f"Phase 2 C2 only: {phase2_c2_cols - phase1_cols - phase2_c1_cols}")
        return False

def merge_datasets(phase1, phase2_c1, phase2_c2):
    """Merge all datasets into a single DataFrame."""
    
    print("\nMerging datasets...")
    
    # Combine Phase 2 datasets first
    phase2_combined = pd.concat([phase2_c1, phase2_c2], ignore_index=True)
    print(f"Phase 2 combined: {phase2_combined.shape[0]} rows")
    
    # Merge Phase 1 and Phase 2
    merged_data = pd.concat([phase1, phase2_combined], ignore_index=True)
    print(f"Final merged dataset: {merged_data.shape[0]} rows, {merged_data.shape[1]} columns")
    
    return merged_data

def generate_summary_stats(merged_data):
    """Generate summary statistics for the merged dataset."""
    
    print("\n" + "="*50)
    print("MERGED DATASET SUMMARY")
    print("="*50)
    
    print(f"Total rows: {merged_data.shape[0]}")
    print(f"Total columns: {merged_data.shape[1]}")
    
    print(f"\nData by phase:")
    print(merged_data['phase'].value_counts())
    
    print(f"\nData by week:")
    print(merged_data['week'].value_counts())
    
    print(f"\nData by condition:")
    print(merged_data['condition'].value_counts())
    
    print(f"\nParticipants by phase:")
    participants_by_phase = merged_data.groupby('phase')['participant_id'].nunique()
    print(participants_by_phase)
    
    print(f"\nTotal unique participants: {merged_data['participant_id'].nunique()}")
    
    print(f"\nColumn list:")
    for i, col in enumerate(merged_data.columns, 1):
        print(f"{i:2d}. {col}")
    
    # Check for missing values in key columns
    print(f"\nMissing values in key columns:")
    key_columns = ['final rating submitted', 'after_AI_seen_before']
    for col in key_columns:
        if col in merged_data.columns:
            missing_count = merged_data[col].isnull().sum()
            missing_pct = (missing_count / len(merged_data)) * 100
            print(f"  {col}: {missing_count} ({missing_pct:.1f}%)")

def save_merged_data(merged_data, output_dir="processed"):
    """Save the merged dataset to the processed directory."""
    
    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(exist_ok=True)
    
    output_path = f"{output_dir}/merged_phase1_phase2_data.csv"
    merged_data.to_csv(output_path, index=False)
    
    print(f"\n✅ Merged data saved to: {output_path}")
    print(f"File size: {os.path.getsize(output_path) / 1024:.1f} KB")

def main():
    """Main function to orchestrate the data merging process."""
    
    print("News Veracity Study - Data Merging Script")
    print("="*50)
    
    try:
        # Load data
        phase1, phase2_c1, phase2_c2 = load_and_prepare_data()
        
        # Clean Phase 2 data
        phase2_c1, phase2_c2 = clean_phase2_data(phase2_c1, phase2_c2)
        
        # Add phase identifiers
        phase1, phase2_c1, phase2_c2 = add_phase_identifiers(phase1, phase2_c1, phase2_c2)
        
        # Verify consistency
        if not verify_column_consistency(phase1, phase2_c1, phase2_c2):
            raise ValueError("Column inconsistency detected. Please check the data.")
        
        # Merge datasets
        merged_data = merge_datasets(phase1, phase2_c1, phase2_c2)
        
        # Generate summary
        generate_summary_stats(merged_data)
        
        # Save results
        save_merged_data(merged_data)
        
        print("\n🎉 Data merging completed successfully!")
        
        return merged_data
        
    except Exception as e:
        print(f"\n❌ Error during data merging: {str(e)}")
        raise

if __name__ == "__main__":
    merged_data = main()