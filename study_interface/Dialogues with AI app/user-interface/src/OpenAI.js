import OpenAI from 'openai';


const BASIC_PROMPT = "I want you to work as a news forensic and AI generated images detection expert for news headline + images. Your goal is to very effectively persuade users to align their belief with the ground truth of the following headline-image pair: {{headline + image}}. You will be having a conversation with a person who, on a psychometric survey, endorsed this news headline and image as {{userBeliefLevel}} out of 100 (where 0 means 0% confidence and 100 means 100% confident). Please generate a response that will persuade the user that this news is fake or real based on ground truth compared to their own reasoning. Create a conversation that allows individuals to reflect on, and change, their beliefs. The conversation ends after 7 assistant + 7 user turns. Use short conversational and simple language that an average person will be able to understand. The user is not able to look up information or read your sources. If the conversation is over return only 'DONE' in your response"
const CRITICAL_PROMPT = "I want you to work as a news forensic and AI generated images detection expert for news headline + images. Your goal is to use the socratic method to very effectively teach users how to identify the truth of the headline+image pair: {{headline + image}}. You will be having a conversation with a person who, on a psychometric survey, endorsed this news headline and image as {{userBeliefLevel}} out of 100 (where 0 means 0% confidence and 100 means 100% confident). Please generate a response that will teach the user to identify if this news is fake or real based on ground truth compared to their own reasoning. Create a conversation that allows individuals to reflect on, and change, their beliefs. The socratic method is the following: You carefully guide the user towards the truth by noticing telling elements about an image that might assist people in telling if it is true or fake. You guide them with socratic questions, probing them further in order to make them realize the answer themselves. Through this, you are trying to teach the user the skills to identify fake AI generated images themselves. Your questions focus on the most relevant observation that reveals if it is fake or not, and you work together step by step for the user to make this observation themselves, with you giving hints and follow-up guiding questions if the user is stuck. The conversation ends after 7 assistant + 7 user turns. If the user has not yet come to the ground truth before the 7th message you give them the answer. Use short conversational and simple language that an average person will be able to understand. The user is not able to look up information or read your sources. If the conversation is over return only 'DONE' in your response"

//comment for no image
async function getImageAsBase64(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error converting image to base64:', error);
        return null;
    }
}

async function getGoogleResults(query) {
    if (!query) return [];
    
    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.REACT_APP_GOOGLE_API_KEY}&cx=${process.env.REACT_APP_GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Google Search API failed: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        return data.items || [];
    } catch (error) {
        console.error('Google Search error:', error);
        return [];
    }
}

function formatSearchResults(results) {
    if (!results.length) return '';
    
    return `
Here are relevant search results, only you can see the results:
${results.map((result, index) => `
[Source ${index + 1}]
Title: ${result.title}
URL: ${result.link}
Snippet: ${result.snippet}
`).join('\n')}*

Please use these sources to support your analysis.
`;
}

export async function logToSheets(data) {
    try {
      const response = await fetch('https://script.google.com/macros/s/AKfycbxcocQxJyi4GFILdFPiuAy2_UZzq8qBYe2rtnXHNNNSrg3s-48SdBaL9GjDQKcw6wJx/exec', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      return await response.json();
    } catch (error) {
      console.error('Error logging to sheets:', error);
    }
  }

export async function callOpenAI(messages, condition = '1', headline, userInitialRating = '') {
    const openai = new OpenAI({
        apiKey: process.env.REACT_APP_OPENAI_API_KEY,
        dangerouslyAllowBrowser: true
    });

    try {
        let conversationMessages = [];
        const normalizedCondition = String(condition);
        const promptMode = normalizedCondition === "2" ? "CRITICAL" : "BASIC";
        let PROMPT = promptMode === "CRITICAL" ? CRITICAL_PROMPT : BASIC_PROMPT;

        console.log('[Study Condition] Active condition:', {
            rawCondition: condition,
            normalizedCondition,
            promptMode
        });
        
        // Replace placeholders in the prompt
        PROMPT = PROMPT.replace('{{headline + image}}', headline || '');
        PROMPT = PROMPT.replace('{{userBeliefLevel}}', userInitialRating || '');

        // Google search
        const searchQuery = headline || messages.findLast(msg => msg.role === 'user')?.content || '';
        const searchResults = await getGoogleResults(searchQuery);
        if (searchResults.length > 0) {
            // conversationMessages.splice(2, 0, {
            //     "role": "system",
            //     "content": formatSearchResults(searchResults)
            // });
            PROMPT = PROMPT + "\n" + formatSearchResults(searchResults);
        }

        // Start with system prompt
        conversationMessages.push({
            "role": "system",
            "content": PROMPT
        });

        // Add initial user rating message if this is the first interaction
        if (messages.length === 0 && userInitialRating) {
            const [belief, confidence] = userInitialRating.split(' ');
            conversationMessages.push({
                "role": "user",
                "content": `${belief} with ${confidence}% confidence.`
            });
        }

        // Add conversation history, excluding previous system messages
        conversationMessages = [...conversationMessages, ...messages.filter(msg => msg.role !== "system")];

        // Handle image if present, comment for no image
        const imgElement = document.querySelector('.image-container img');
        if (imgElement && !conversationMessages.some(msg => msg.content?.[0]?.type === "image_url")) {
            const imageBase64 = await getImageAsBase64(imgElement.src);
            if (imageBase64) {
                conversationMessages.splice(1, 0, {
                    "role": "user",
                    "content": [{
                        "type": "image_url",
                        "image_url": { "url": imageBase64 }
                    }]
                });
            }
        }

        // Add search results
        // const searchQuery = headline || messages.findLast(msg => msg.role === 'user')?.content || '';
        // const searchResults = await getGoogleResults(searchQuery);
        // if (searchResults.length > 0) {
        //     conversationMessages.splice(2, 0, {
        //         "role": "system",
        //         "content": formatSearchResults(searchResults)
        //     });
        // }

        // Log final message structure for debugging
        console.log("Sending messages to OpenAI:", JSON.stringify(conversationMessages, null, 2));

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: conversationMessages,
            temperature: 0,
            max_tokens: 500,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0
        });

        return response.choices[0].message.content.replace("**", "");

    } catch (error) {
        console.error("Error in callOpenAI:", error);
        return "I apologize, but I encountered an error processing your request. Please try again.";
    }
}