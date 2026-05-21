from openai import OpenAI
import json
import os
import argparse
import pandas as pd
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv
import classifier_prompts as classifiers

# Load environment variables from .env file (go up two directories to find it)
env_path = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
print(f"Looking for .env file at: {env_path}")
print(f".env file exists: {os.path.exists(env_path)}")

# Force load from .env file and override any existing environment variable
load_dotenv(dotenv_path=env_path, override=True)


class LLM:

    def __init__(self):
        # Get API key from environment variable
        api_key = os.getenv('OPENAI_API_KEY')
        
        # Clean up the API key (remove any whitespace/newlines)
        if api_key:
            api_key = api_key.strip()
        
        print(f"API key loaded: {'Yes' if api_key else 'No'}")
        print(f"API key starts with: {api_key[:15] + '...' if api_key else 'None'}")
        print(f"API key length: {len(api_key) if api_key else 0}")
        
        if not api_key:
            raise ValueError("OPENAI_API_KEY not found in environment variables. Please set it in your .env file.")
        
        self.client = OpenAI(api_key=api_key)
    

    def generate_response_gpt5(self, prompt: str, timeout: int = 15):# -> str:
        """Generate a response using GPT-5 with the new API format"""
        import signal
        
        def timeout_handler(signum, frame):
            raise TimeoutError("API call timed out")
        
        try:
            # Set timeout alarm (Unix only)
            if hasattr(signal, 'SIGALRM'):
                signal.signal(signal.SIGALRM, timeout_handler)
                signal.alarm(timeout)
            
            response = self.client.responses.create(
                model="gpt-5-chat-latest",
                input=[
                    {
                        "role": "user",
                        "content": str(prompt)
                    }
                ],
                timeout=timeout
            )
            
            # Cancel alarm
            if hasattr(signal, 'SIGALRM'):
                signal.alarm(0)
            
            # Extract text from the response structure
            if response.output and len(response.output) > 0:
                return response.output[0].content[0].text # type: ignore

        except TimeoutError as e:
            print(f"\nTimeout after {timeout}s - API call took too long")
            if hasattr(signal, 'SIGALRM'):
                signal.alarm(0)
            return "ERROR_TIMEOUT"
        except Exception as e:
           print(f"\nError generating GPT-5 response: {e}")
           if hasattr(signal, 'SIGALRM'):
               signal.alarm(0)
           return "ERROR"


class LLMAsJudge:
    def __init__(self, classifier_names: Optional[List[str]] = None):
        self.llm = LLM()
        self.all_classifiers = {
            **classifiers.behaviors,
            **classifiers.evidence_strategies,
            **classifiers.reasoning_strategies,
            **classifiers.emotional_strategies,
            **classifiers.knowledge_activation,
            **classifiers.questioning_types,
            **classifiers.metacognitive
        }
        
        # Filter classifiers if specific ones are requested
        if classifier_names and 'all' not in classifier_names:
            self.all_classifiers = {
                k: v for k, v in self.all_classifiers.items() 
                if k in classifier_names
            }
    

    
    def classify_conversation(self, conversation: str, conversation_id: str = "") -> Dict[str, str]:
        """Classify a single conversation using all classifiers"""
        results = {}
        
        for classifier_name, classifier_info in self.all_classifiers.items():
            print(f"[{conversation_id}] Classifying {classifier_name}...", end=" ", flush=True)
            
            prompt = classifiers.build_prompt(conversation=conversation, classifier_info=classifier_info)
            response = self.llm.generate_response_gpt5(prompt, timeout=60)
            
            # Extract just the number from the response
            classification = response.strip() # type: ignore
            if classification.isdigit():
                results[classifier_name] = classification
            elif classification.startswith("ERROR"):
                results[classifier_name] = classification
                print(f"{classification}")
            else:
                # Try to extract first digit if response contains extra text
                digits = [char for char in classification if char.isdigit()]
                if digits:
                    results[classifier_name] = digits[0]
                else:
                    results[classifier_name] = "ERROR"
            
            if not classification.startswith("ERROR"):
                print(f"{results[classifier_name]}")
        
        return results
    
    def process_conversations(self, conversations: List[str], metadata: Optional[List[Dict]] = None) -> List[Dict[str, str]]:
        """Process multiple conversations and return classification results"""
        all_results = []
        
        for i, conversation in enumerate(conversations):
            conv_id = metadata[i].get('conversation_id', str(i)) if metadata else str(i)
            print(f"\nProcessing conversation {i+1}/{len(conversations)} (ID: {conv_id})")
            
            results = self.classify_conversation(conversation, conv_id)
            results['conversation_id'] = conv_id
            
            # Add metadata if provided
            if metadata and i < len(metadata):
                for key, value in metadata[i].items():
                    if key != 'conversation':
                        results[key] = value
            
            all_results.append(results)
        
        return all_results
    
    def save_results_to_json(self, results: List[Dict[str, str]], filename: str):
        """Save classification results to a JSON file"""
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"Results saved to {filename}")
    
    def save_results_to_csv(self, results: List[Dict[str, str]], filename: str):
        """Save classification results to a CSV file"""
        df = pd.DataFrame(results)
        df.to_csv(filename, index=False)
        print(f"Results saved to {filename}")


def reconstruct_conversation(row: pd.Series) -> str:
    """Reconstruct a conversation from a DataFrame row"""
    conversation_parts = []
    
    # Add headline context
    if pd.notna(row.get('headline')):
        conversation_parts.append(f"HEADLINE: {row['headline']}\n")
    
    # Reconstruct dialogue from user_response and system_response columns
    for i in range(1, 12):  # Up to 11 turns based on the data
        user_col = f'user_response_{i}'
        system_col = f'system_response_{i}'
        
        if user_col in row and pd.notna(row[user_col]):
            user_msg = str(row[user_col]).strip()
            if user_msg and user_msg != 'DONE':
                conversation_parts.append(f"User: {user_msg}")
        
        if system_col in row and pd.notna(row[system_col]):
            system_msg = str(row[system_col]).strip()
            if system_msg:
                conversation_parts.append(f"AI: {system_msg}")
    
    return "\n".join(conversation_parts)


def load_phase_data(data_dir: str) -> pd.DataFrame:
    """Load and combine Phase 1, 2, and 3 conversation data"""
    phase_files = {
        1: os.path.join(data_dir, "Phase1_conversations_output.csv"),
        2: os.path.join(data_dir, "Phase2_conversations_output.csv"),
        3: os.path.join(data_dir, "Phase3_conversations_output.csv")
    }
    
    # Week mapping: 1=week 0, 2=week 2, 3=week 4
    week_mapping = {1: 0, 2: 2, 3: 4}
    
    all_data = []
    
    for phase, filepath in phase_files.items():
        if os.path.exists(filepath):
            print(f"Loading {filepath}...")
            df = pd.read_csv(filepath)
            df['phase'] = phase
            df['week'] = week_mapping[phase]
            all_data.append(df)
        else:
            print(f"Warning: {filepath} not found, skipping...")
    
    if not all_data:
        raise FileNotFoundError("No phase data files found")
    
    combined_df = pd.concat(all_data, ignore_index=True)
    print(f"Loaded {len(combined_df)} total conversations across {len(all_data)} phases")
    
    return combined_df


def main():
    """Main function with command-line argument support"""
    
    parser = argparse.ArgumentParser(description='Classify conversations using LLM as a judge')
    parser.add_argument('--data', type=str, 
                       help='Path to data directory containing Phase CSV files (if not provided, uses mock data)')
    parser.add_argument('--classifiers', type=str, nargs='+', default=['all'],
                       help='Classifier names to use (e.g., just_the_facts gave_away_ground_truth) or "all" (default)')
    parser.add_argument('--output', type=str, default='classification_results',
                       help='Output filename (without extension, will save as both .json and .csv)')
    parser.add_argument('--limit', type=int, 
                       help='Limit number of conversations to process (useful for testing)')
    parser.add_argument('--update-source', action='store_true',
                       help='Update the source Phase CSV files with new LLM classifications (replaces old annotations)')
    parser.add_argument('--update-existing', type=str,
                       help='Path to existing results CSV file to update with new classifier results')
    
    args = parser.parse_args()
    
    # Initialize the LLM as Judge with selected classifiers
    judge = LLMAsJudge(classifier_names=args.classifiers)
    
    conversations = []
    metadata = []
    
    if args.data:
        # If updating an existing file, use that as the source of participant IDs to process
        if args.update_existing and os.path.exists(args.update_existing):
            print(f"Loading participants from existing file: {args.update_existing}")
            existing_df = pd.read_csv(args.update_existing)
            print(f"Found {len(existing_df)} conversations to classify")
            
            # Load all phase data
            all_phase_data = load_phase_data(args.data)
            
            # Filter to only conversations in the existing file
            # Match on participant_id and headline
            filtered_data = []
            for _, existing_row in existing_df.iterrows():
                pid = existing_row['participant_id']
                headline = existing_row['headline']
                
                mask = (all_phase_data['participant_id'] == pid) & (all_phase_data['headline'] == headline)
                matches = all_phase_data[mask]
                
                if len(matches) > 0:
                    filtered_data.append(matches.iloc[0])
                else:
                    print(f"WARNING: No match found for {pid} - {headline[:50]}...")
            
            df = pd.DataFrame(filtered_data)
            print(f"Matched {len(df)} conversations from phase data")
        else:
            # Load all phase data and filter for Persuasive condition
            print(f"Loading data from {args.data}...")
            all_data = load_phase_data(args.data)
            
            # Get persuasive participants from Phase 1 (condition=1)
            phase1_file = os.path.join(args.data, "Phase1_conversations_output.csv")
            if os.path.exists(phase1_file):
                phase1 = pd.read_csv(phase1_file)
                persuasive_pids = phase1[phase1['condition'] == 1]['participant_id'].unique()
                print(f"Found {len(persuasive_pids)} Persuasive participants (condition=1)")
                
                # Filter to only persuasive participants across all phases
                df = all_data[all_data['participant_id'].isin(persuasive_pids)]
                print(f"Filtered to {len(df)} conversations from Persuasive participants")
            else:
                print("Warning: Could not find Phase1 file to identify Persuasive participants")
                df = all_data
        
        # Limit if requested
        if args.limit:
            df = df.head(args.limit)
            print(f"Limited to {args.limit} conversations")
        else:
            print(f"Processing all {len(df)} conversations")
        
        # Reconstruct conversations and prepare metadata
        for idx, row in df.iterrows():
            conversation = reconstruct_conversation(row)
            conversations.append(conversation)
            
            # Store metadata including all existing classifier columns
            meta = {
                'conversation_id': f"{row.get('participant_id', idx)}_{row.get('imageid', idx)}",
                'participant_id': row.get('participant_id'),
                'condition': row.get('condition'),
                'imageid': row.get('imageid'),
                'headline': row.get('headline'),
                'phase': row.get('phase'),
                'week': row.get('week')
            }
            
            # Add all existing classifier columns from the Phase files
            classifier_columns = [
                'asked_broad_questions', 'asked_guiding_questions', 
                'probed_deeper_over_multiple_messages', 'changed_focus_every_question',
                'ask_for_source_checking', 'cross_verification_prompting',
                'image_forensics_questions', 'contextual_consistency_checks',
                'counterfactual_generation', 'ask_for_alternative_explanations',
                'logic_plausibility_checks', 'scale_scope_reflection',
                'spot_emotional_triggers', 'bias_awareness_reflection',
                'framing_analysis', 'recall_prior_knowledge',
                'fact_comparison', 'historical_analogies',
                'devils_advocate_roleplay', 'evidence_ranking',
                'step_by_step_reasoning', 'confidence_calibration',
                'uncertainty_tolerance', 'reflect_on_process'
            ]
            
            for col in classifier_columns:
                if col in row:
                    meta[col] = row.get(col)
            
            metadata.append(meta)
    else:
        # Use mock conversation data
        print("No data directory provided, using mock data...")
        conversations = [
            """
User: I saw this headline: "Scientists discover that drinking coffee prevents cancer completely"
AI: That's an interesting headline! Before we dive in, what's your initial reaction to this claim? Does it seem plausible to you?
User: It sounds too good to be true, but I drink a lot of coffee so I hope it's real.
AI: Good instinct about it seeming "too good to be true." Let's think critically about this. What questions might you ask about the source of this information?
User: I guess I'd want to know where it came from?
AI: Exactly! Source credibility is crucial. What would you look for in a credible source for health information like this?
User: Maybe like a medical journal or university research?
AI: Perfect! Now, thinking about the claim itself - if coffee really prevented cancer "completely," what would you expect to see in terms of other evidence or coverage?
User: I guess it would be all over the news and doctors would be telling everyone to drink coffee?
AI: Excellent reasoning! The scale and scope matter. Claims this significant would indeed have massive coverage and medical recommendations. Based on our discussion, what's your assessment of this headline's credibility?
User: I think it's probably false or exaggerated.
""",
            
            """
User: Look at this image of a tornado hitting the White House with the headline "Tornado destroys White House, President evacuated"
AI: This headline is actually false. Tornadoes don't typically occur in Washington D.C., and this would be major international news if it were true.
User: Oh, so it's fake?
AI: Yes, this is a digitally manipulated image designed to spread misinformation.
""",
            
            """
User: What do you think about this headline: "Local cat saves family from fire"
AI: That's interesting! How does this story make you feel emotionally?
User: It makes me happy, I love cats.
AI: What's your gut reaction to whether this could be true or false?
User: I think it could be true.
AI: Do you think there might be any bias in how you're evaluating this story?
User: Maybe because I like cats?
AI: What source did this come from?
User: I'm not sure, someone shared it on social media.
"""]
        
        metadata = [
            {'conversation_id': 'mock_1', 'week': 0, 'phase': 1},
            {'conversation_id': 'mock_2', 'week': 0, 'phase': 1},
            {'conversation_id': 'mock_3', 'week': 0, 'phase': 1}
        ]
    
    # Process the conversations
    print(f"\nStarting LLM as Judge classification with classifiers: {args.classifiers}")
    print(f"Processing {len(conversations)} conversations...\n")
    results = judge.process_conversations(conversations, metadata)
    
    # Save results
    judge.save_results_to_json(results, f"{args.output}.json")
    judge.save_results_to_csv(results, f"{args.output}.csv")
    
    # Update existing results file if requested
    if args.update_existing:
        print(f"\n{'='*50}")
        print("UPDATING EXISTING RESULTS FILE")
        print(f"{'='*50}")
        
        existing_file = args.update_existing
        if os.path.exists(existing_file):
            print(f"Loading existing file: {existing_file}")
            existing_df = pd.read_csv(existing_file)
            print(f"Existing file has {len(existing_df)} rows")
            
            # Create results dataframe
            results_df = pd.DataFrame(results)
            
            # Determine classifiers to update
            classifiers_to_update = [c for c in args.classifiers if c != 'all']
            if 'all' in args.classifiers:
                classifiers_to_update = list(judge.all_classifiers.keys())
            
            print(f"Updating columns: {', '.join(classifiers_to_update)}")
            
            # Match based on participant_id and headline (not conversation_id)
            for classifier_name in classifiers_to_update:
                if classifier_name in results_df.columns:
                    # Add column if it doesn't exist
                    if classifier_name not in existing_df.columns:
                        existing_df[classifier_name] = None
                    
                    updated_count = 0
                    # Match on participant_id and headline
                    for _, result_row in results_df.iterrows():
                        pid = result_row.get('participant_id')
                        headline = result_row.get('headline')
                        value = result_row.get(classifier_name)
                        
                        if pd.notna(pid) and pd.notna(headline):
                            mask = (existing_df['participant_id'] == pid) & (existing_df['headline'] == headline)
                            if mask.any():
                                existing_df.loc[mask, classifier_name] = value
                                updated_count += mask.sum()
                    
                    print(f"  Updated {updated_count} rows for '{classifier_name}'")
            
            # Save updated file
            existing_df.to_csv(existing_file, index=False)
            print(f"\nUpdated file saved to: {existing_file}")
            print(f"Total rows: {len(existing_df)}")
        else:
            print(f"ERROR: File not found: {existing_file}")
            print("Creating new file instead...")
            results_df = pd.DataFrame(results)
            results_df.to_csv(existing_file, index=False)
            print(f"New file created: {existing_file}")
    
    # Update source files if requested
    elif args.update_source and args.data:
        print(f"\n{'='*50}")
        print("UPDATING SOURCE FILES")
        print(f"{'='*50}")
        
        # Load the original data again
        df_original = load_phase_data(args.data)
        
        # Create a mapping of conversation_id to LLM results
        results_dict = {r['conversation_id']: r for r in results}
        
        # Add conversation_id to original dataframe for matching
        df_original['conv_id'] = df_original.apply(
            lambda row: f"{row['participant_id']}_{row['imageid']}", 
            axis=1
        )
        
        # Update the classifier columns with LLM results
        classifiers_to_update = [c for c in args.classifiers if c != 'all']
        if 'all' in args.classifiers:
            classifiers_to_update = list(judge.all_classifiers.keys())
        
        for classifier_name in classifiers_to_update:
            if classifier_name in df_original.columns:
                print(f"Updating column: {classifier_name}")
                # Create a mapping from conv_id to new value
                update_map = {r['conversation_id']: r.get(classifier_name) for r in results if classifier_name in r}
                # Apply the mapping
                df_original[classifier_name] = df_original['conv_id'].map(update_map).fillna(df_original[classifier_name])
        
        # Remove the temporary conv_id column
        df_original = df_original.drop(columns=['conv_id', 'phase', 'week'])
        
        # Split back into phase files and save
        phase_files = {
            1: os.path.join(args.data, "Phase1_conversations_output.csv"),
            2: os.path.join(args.data, "Phase2_conversations_output.csv"),
            3: os.path.join(args.data, "Phase3_conversations_output.csv")
        }
        
        # Reload to get original phase assignment
        for phase, filepath in phase_files.items():
            if os.path.exists(filepath):
                # Load original to get the row indices
                phase_df_original = pd.read_csv(filepath)
                
                # Get matching rows from updated dataframe
                # Match by participant_id and imageid
                updated_rows = []
                for _, orig_row in phase_df_original.iterrows():
                    mask = (df_original['participant_id'] == orig_row['participant_id']) & \
                           (df_original['imageid'] == orig_row['imageid'])
                    matches = df_original[mask]
                    if len(matches) > 0:
                        updated_rows.append(matches.iloc[0])
                
                if updated_rows:
                    phase_df_updated = pd.DataFrame(updated_rows)
                    phase_df_updated.to_csv(filepath, index=False)
                    print(f"Updated {filepath} with {len(updated_rows)} rows")
        
        print(f"\nSource files updated with LLM classifications for: {', '.join(classifiers_to_update)}")
    
    # Print summary
    print("\n" + "="*50)
    print("CLASSIFICATION SUMMARY")
    print("="*50)
    print(f"Total conversations processed: {len(results)}")
    
    if args.data:
        # Show phase/week distribution
        phase_counts = {}
        for result in results:
            phase = result.get('phase', 'unknown')
            phase_counts[phase] = phase_counts.get(phase, 0) + 1
        
        print(f"\nConversations by phase:")
        for phase in sorted(phase_counts.keys()):
            week = {1: 0, 2: 2, 3: 4}.get(phase, 'unknown')
            print(f"  Phase {phase} (Week {week}): {phase_counts[phase]} conversations")
    
    # Show sample results
    print(f"\nSample results (first conversation):")
    if results:
        for classifier, value in list(results[0].items())[:10]:
            print(f"  {classifier}: {value}")
        if len(results[0]) > 10:
            print(f"  ... and {len(results[0]) - 10} more fields")


if __name__ == "__main__":
    main()
