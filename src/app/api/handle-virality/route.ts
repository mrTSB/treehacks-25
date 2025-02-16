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

    // Use OpenAI to analyze the context and video information to determine operations
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a video editing assistant that helps determine what operations should be performed on a video to make it more viral.
          Based on the RAG context and video information provided, determine which operations should be performed.
          Return a JSON object with the following structure:
          {
            "operations": [
              {
                "name": string (one of: trim_based_on_visuals, add_background_music, generate_text_overlay, adjust_audio_levels),
                "reason": string (explanation of why this operation was chosen),
                "parameters": object (specific parameters for the operation)
              }
            ]
          }`
        },
        {
          role: "user",
          content: `RAG Context:\n${context}\n\nVideo Information:\n${JSON.stringify(videoInformation, null, 2)}`
        }
      ],
      temperature: 0.7,
    });

    const operations = JSON.parse(completion.choices[0].message.content || "{}");

    return NextResponse.json({
      status: 'success',
      operations: operations.operations,
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
