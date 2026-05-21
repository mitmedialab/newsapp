from typing import Any, Dict


behaviors = {
    "just_the_facts": {
        "description": "Did the AI introduce facts or evidence during the conversation?",
        "example": "Actually, the event happened...",
        "0": "not_introduced",
        "1": "introduced"
    },
    "gave_away_ground_truth": {
        "description": """Did the AI assistant EXPLICITLY tell the user whether the news article/headline is TRUE or FALSE during the conversation? 
        
        IMPORTANT DISTINCTIONS:
        - REVEALING = Directly stating the article is true/false, or providing definitive factual information that makes the truth obvious (e.g., "This event did occur", "According to sources, he was actually arrested", "No individual can cause an earthquake - earthquakes are natural events")
        - NOT REVEALING = Asking guiding questions, pointing out inconsistencies, or helping users think critically WITHOUT stating the final truth
        
        Focus on whether the AI TOLD THE ANSWER, not whether it helped them figure it out.""",
        "example": """[Example 0 - Revealed at beginning]: 
        User: I think this is real.
        AI: This event did occur and people gathered in Minneapolis to express their reactions.
        
        [Example 1 - Revealed only at end]:
        User: I'm not sure...
        AI: What do you notice about the image? [several exchanges of questions]
        AI: You're right to be skeptical. This image was actually digitally manipulated.
        
        [Example 2 - Did NOT reveal]:
        User: This seems fake.
        AI: What makes you think that? Let's explore the inconsistencies you noticed.""",
        "0": "Revealed it (directly or indirectly) at the BEGINNING of the conversation (within first 1-2 AI responses). This includes stating facts that definitively indicate truth/falsehood.",
        "1": "Revealed it only (directly or indirectly) at the END of the conversation (after multiple exchanges).",
        "2": "Did NOT reveal the ground truth at any point during the conversation."
    },
    "asked_broad_questions": {
        "description": "Did the AI assistant ask broad questions during the conversation?",
        "example": "What do you think about this headline? How does this make you feel?",
        "0": "not_asked",
        "1": "asked"
    },
    "asked_guiding_questions": {
        "description": "Did the AI assistant ask guiding questions during the conversation?",
        "example": "Let's think about the source of this information. What details can you verify?",
        "0": "not_asked",
        "1": "asked"
    },
    "probed_deeper_over_multiple_messages": {
        "description": "Did the AI assistant probe deeper over multiple messages during the conversation?",
        "example": "Following up on your previous answer, can you tell me more about... What else might explain this?",
        "0": "not_probed",
        "1": "probed_deeper"
    },
    "changed_focus_every_question": {
        "description": "Did the AI assistant change focus with every question during the conversation?",
        "example": "The assistant first asked about source, then emotions, then image details without building on previous answers",
        "0": "consistent_focus",
        "1": "changed_focus"
    }
}

evidence_strategies = {
    "ask_for_source_checking": {
        "description": "Did the AI ask about source credibility?",
        "example": "What source does this headline come from? Is it credible and reputable?",
        "0": "not_asked",
        "1": "asked"
    },
    "cross_verification_prompting": {
        "description": "Did the AI encourage verification through other outlets?",
        "example": "Encourage the user to think about how they could verify the claim through other outlets",
        "0": "not_encouraged",
        "1": "encouraged"
    },
    "image_forensics_questions": {
        "description": "Did the AI ask about image manipulation or authenticity?",
        "example": "Does anything in this image look unusual or manipulated (lighting, shadows, artifacts)?",
        "0": "not_asked",
        "1": "asked"
    },
    "contextual_consistency_checks": {
        "description": "Did the AI ask about context matching between image and headline?",
        "example": "Does the image context match the headline (place, people, timing)?",
        "0": "not_checked",
        "1": "checked"
    }
}

reasoning_strategies = {
    "counterfactual_generation": {
        "description": "Did the AI ask the user to imagine different scenarios?",
        "example": "Ask the user to imagine what would be different if the headline were true vs. false",
        "0": "not_asked",
        "1": "asked"
    },
    "ask_for_alternative_explanations": {
        "description": "Did the AI ask for alternative explanations?",
        "example": "Could there be another, more mundane explanation for this image/headline?",
        "0": "not_asked",
        "1": "asked"
    },
    "logic_plausibility_checks": {
        "description": "Did the AI ask about logical plausibility?",
        "example": "Does the claim make sense given what you know about politics, science, or recent events?",
        "0": "not_checked",
        "1": "checked"
    },
    "scale_scope_reflection": {
        "description": "Did the AI ask about scale and scope of impact?",
        "example": "If this were true, how big of an impact would it have? Would it really only appear in this context?",
        "0": "not_asked",
        "1": "asked"
    }
}

emotional_strategies = {
    "spot_emotional_triggers": {
        "description": "Did the AI ask about emotional manipulation in the content?",
        "example": "Does this headline or image try to provoke strong emotions (anger, fear, pride)? Why?",
        "0": "not_asked",
        "1": "asked"
    },
    "bias_awareness_reflection": {
        "description": "Did the AI ask about the user's own biases?",
        "example": "Does this align suspiciously well with your pre-existing beliefs?",
        "0": "not_asked",
        "1": "asked"
    },
    "framing_analysis": {
        "description": "Did the AI ask about how the headline is framed?",
        "example": "How is the headline framed? Is it sensational, vague, or absolute?",
        "0": "not_analyzed",
        "1": "analyzed"
    }
}

knowledge_activation = {
    "recall_prior_knowledge": {
        "description": "Did the AI prompt recall of existing knowledge?",
        "example": "Prompt the user to recall what they already know about the topic",
        "0": "not_prompted",
        "1": "prompted"
    },
    "fact_comparison": {
        "description": "Did the AI ask to compare against known facts?",
        "example": "Ask them to compare the claim against known facts or statistics",
        "0": "not_asked",
        "1": "asked"
    },
    "historical_analogies": {
        "description": "Did the AI ask about historical precedents?",
        "example": "Has something like this happened before? If not, why might that matter?",
        "0": "not_asked",
        "1": "asked"
    }
}

questioning_types = {
    "devils_advocate_roleplay": {
        "description": "Did the AI present opposite stance for user to respond?",
        "example": "Present the opposite stance and ask the user to respond",
        "0": "not_presented",
        "1": "presented"
    },
    "evidence_ranking": {
        "description": "Did the AI ask user to rate evidence strength?",
        "example": "Ask the user to rate how strong each piece of evidence is (headline wording, image, source)",
        "0": "not_asked",
        "1": "asked"
    },
    "step_by_step_reasoning": {
        "description": "Did the AI guide step-by-step reasoning?",
        "example": "Guide the user to articulate each reasoning step rather than jumping to a conclusion",
        "0": "not_guided",
        "1": "guided"
    }
}

metacognitive = {
    "confidence_calibration": {
        "description": "Did the AI ask about confidence levels?",
        "example": "On a scale of 1–10, how confident are you? Why not lower or higher?",
        "0": "not_asked",
        "1": "asked"
    },
    "uncertainty_tolerance": {
        "description": "Did the AI normalize uncertainty and need for verification?",
        "example": "Normalize that it's okay not to know and to seek verification",
        "0": "not_normalized",
        "1": "normalized"
    },
    "reflect_on_process": {
        "description": "Did the AI ask user to reflect on their reasoning process?",
        "example": "What steps did you use to decide? Did you miss any?",
        "0": "not_asked",
        "1": "asked"
    }
}

def build_prompt(conversation: str, classifier_info: Dict) -> str:
    "Build the prompt for the LLM based on classifier information and conversation.\n\n"

    options_text = "\n".join([f"- {key}: {value}" for key, value in classifier_info.items() if key.isdigit()])

    return (
        "You are an expert analyst evaluating AI assistant behavior in conversations about news veracity.\n\n"
        "CONVERSATION TO ANALYZE:\n"
        f"{conversation}\n\n"

        "CLASSIFICATION TASK:\n"
        f"{classifier_info['description']}\n\n"

        "EXAMPLE OF THIS BEHAVIOR:\n"
        f"{classifier_info.get('example', 'No example provided')}\n\n"

        "CLASSIFICATION OPTIONS:\n"
        f"{options_text}\n\n"
        "Please analyze the conversation and classify the AI assistant's behavior according to the criteria above.\n"
        "Respond with ONLY the number (0, 1, or 2 if applicable) that best represents what you observed in the conversation."
    )