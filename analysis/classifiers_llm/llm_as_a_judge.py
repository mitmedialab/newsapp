from openai import OpenAI
import json
import os
from typing import Dict, List, Any
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
    

    def generate_response_gpt5(self, prompt: str):# -> str:
        """Generate a response using GPT-5 with the new API format"""
        try:
            response = self.client.responses.create(
                model="gpt-4o",
                input=[
                    {
                        "role": "user",
                        "content": str(prompt)
                    }
                ]
            )
            # Extract text from the response structure
            if response.output and len(response.output) > 0:
                return response.output[0].content[0].text # type: ignore

        except Exception as e:
           print(f"Error generating GPT-5 response: {e}")
           return ""


class LLMAsJudge:
    def __init__(self):
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
    

    
    def classify_conversation(self, conversation: str) -> Dict[str, str]:
        """Classify a single conversation using all classifiers"""
        results = {}
        
        for classifier_name, classifier_info in self.all_classifiers.items():
            prompt = classifiers.build_prompt(conversation=conversation, classifier_info=classifier_info)
            response = self.llm.generate_response_gpt5(prompt)
            
            # Extract just the number from the response
            classification = response.strip() # type: ignore
            if classification.isdigit():
                results[classifier_name] = classification
            else:
                # Try to extract first digit if response contains extra text
                digits = [char for char in classification if char.isdigit()]
                if digits:
                    results[classifier_name] = digits[0]
                else:
                    results[classifier_name] = "ERROR"
            
            print(f"Classified {classifier_name}: {results[classifier_name]}")
        
        return results
    
    def process_conversations(self, conversations: List[str]) -> List[Dict[str, str]]:
        """Process multiple conversations and return classification results"""
        all_results = []
        
        for i, conversation in enumerate(conversations):
            print(f"\nProcessing conversation {i+1}/{len(conversations)}")
            results = self.classify_conversation(conversation)
            results['conversation_id'] = str(i)
            all_results.append(results)
        
        return all_results
    
    def save_results_to_json(self, results: List[Dict[str, str]], filename: str):
        """Save classification results to a JSON file"""
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"Results saved to {filename}")


def main():
    """Main function with mock data for testing"""
    
    # Mock conversation data
    mock_conversations = [
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
    
    # Initialize the LLM as Judge
    judge = LLMAsJudge()
    
    # Process the mock conversations
    print("Starting LLM as Judge classification...")
    results = judge.process_conversations(mock_conversations)
    
    # Save results
    judge.save_results_to_json(results, "classification_results.json")
    
    # Print summary
    print("\n" + "="*50)
    print("CLASSIFICATION SUMMARY")
    print("="*50)
    
    for i, result in enumerate(results):
        print(f"\nConversation {i+1} Results:")
        for classifier, value in result.items():
            if classifier != 'conversation_id':
                print(f"  {classifier}: {value}")


if __name__ == "__main__":
    main()
