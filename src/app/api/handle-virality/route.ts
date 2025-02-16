import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(request: Request) {
  try {
    const { videoInformation } = await request.json();

    if (!videoInformation) {
      return NextResponse.json(
        { error: 'Missing video information' },
        { status: 400 }
      );
    }

    // Get recommendations from the RAG pipeline
    const ragResponse = await fetch('http://127.0.0.1:8003/get-viral-recommendations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_info: videoInformation
      })
    });

    const ragData = await ragResponse.json();

    console.log(ragData)

    if (!ragData.recommendations || !ragData.recommendations.length) {
      return NextResponse.json(
        { error: 'No recommendations found from RAG pipeline' },
        { status: 404 }
      );
    }

    // Combine all recommendations into a single context
    const context = ragData.recommendations.map((rec: any) => rec.content).join('\n\n');

    const validOperations = [
      'trim_based_on_visuals',
      'add_background_music',
      'generate_text_overlay',
      'adjust_audio_levels',
      'remove_unnecessary_audio',
      'add_sound_effects',
      'generate_voiceover'
    ];

    // Use OpenAI to analyze the context and video information to determine operations
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a video editing assistant that helps determine what operations should be performed on a video to make it more viral.
          Based on the RAG context and video information provided, determine which operations should be performed.
          You can only choose from the following operations:
          - trim_based_on_visuals: Analyze the video frames and remove unnecessary parts
          - add_background_music: Add background music to enhance engagement
          - generate_text_overlay: Add text overlays like captions or titles
          - adjust_audio_levels: Balance audio elements for professional sound
          - remove_unnecessary_audio: Clean up audio by removing redundant sounds
          - add_sound_effects: Add appropriate sound effects for immersion
          - generate_voiceover: Create AI voiceover narration

          Respond with a JSON object (no markdown formatting, no backticks) with this exact structure:
          {
            "operations": [
              {
                "name": string (must be one of the operations listed above),
                "reason": string (explanation of why this operation was chosen),
                "parameters": object (specific parameters for the operation)
              }
            ]
          }
          
          Choose only the most relevant operations that would make the video more viral based on current trends and best practices.`
        },
        {
          role: "user",
          content: `RAG Context:\n${context}\n\nVideo Information:\n${JSON.stringify(videoInformation, null, 2)}`
        }
      ],
      temperature: 0.7,
    });

    let operations;
    try {
      const content = completion.choices[0].message.content || "{}";
      // Remove any markdown formatting or backticks if present
      const cleanJson = content.replace(/```json\n?|\n?```/g, '').trim();
      operations = JSON.parse(cleanJson);
    } catch (error) {
      console.error('Error parsing operations JSON:', error);
      operations = { operations: [] };
    }

    return NextResponse.json({
      status: 'success',
      operations: operations.operations || [],
      rag_context: context
    });

  } catch (error) {
    console.error('Error in handle-virality:', error);
    return NextResponse.json(
      { error: 'Failed to process video virality' },
      { status: 500 }
    );
  }
}
