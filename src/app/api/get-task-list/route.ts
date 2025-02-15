import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from "zod"
import { zodResponseFormat } from "openai/helpers/zod"

type Operation = {
    name: string;
    description: string;
}

const schema = z.object({
  generate_visuals: z.boolean(),
  generate_text_overlay: z.boolean(),
  remove_unnecessary_audio: z.boolean(),
  trim_based_on_visuals: z.boolean(),
  add_background_music: z.boolean(),
  generate_voiceover: z.boolean(),
  adjust_audio_levels: z.boolean(),
  add_sound_effects: z.boolean(),
})

/**
 * POST method for get-task-list.
 * This endpoint takes a user prompt that instructs the assistant which video editing 
 * operations should be performed. The assistant returns a structured response with an 
 * array of objects, each identifying an operation and whether it should be performed.
 */
export async function POST(request: Request) {
  try {
    const { userPrompt } = await request.json()

    // Define the complete list of available operations.
    const taskList: Operation[] = [
      {
        name: 'Generate Visuals',
        description: 'Generate new visuals for the video with a text-to-video model.'
      },
      {
        name: 'Generate Text Overlay',
        description: 'Generate a text overlay for the video.'
      },
      {
        name: 'Remove Unnecessary Audio',
        description: 'Look for any audio that is repeated or not needed and remove it.'
      },
      {
        name: 'Trim Based on Visuals',
        description: 'Analyze the video frames and remove unnecessary parts.'
      },
      {
        name: 'Add Background Music',
        description: 'Add background music to the video.'
      },
      {
        name: 'Generate Voiceover',
        description: 'Generate a voiceover for the video.'
      },
      {
        name: 'Adjust Audio Levels',
        description: 'Adjust the audio levels of the video.'
      },
      {
        name: 'Add Sound Effects',  
        description: 'Add sound effects to the video.'
      },
    ]

    let tasksToPerform: Operation[] = []

    // Initialize the OpenAI client.
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })

    // Create messages that include the full list of available operations.
    // The assistant is instructed to return an array of objects, each with the following keys:
    // "operation_name" (which should match one of the available operations) and "perform" (true or false).
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are a video editing assistant.
Based on the user's prompt, decide which of the following operations should be performed.
Return a JSON array of objects with two keys:
"operation_name": a string corresponding to one of the following operations: ${taskList.map(t => t.name).join(', ')},
"perform": a boolean indicating whether the operation should be performed.`
      },
      { role: "user", content: userPrompt }
    ]

    // Use OpenAI's chat completions with the custom response format.
    const completion = await client.beta.chat.completions.parse({
      model: "gpt-4o-2024-08-06",
      messages,
      response_format: zodResponseFormat(schema, "task_operations"),
    })

    // Extract the parsed output and handle possible null
    const operationsDecision = completion.choices[0].message.parsed

    console.log(operationsDecision)

    return NextResponse.json({ tasks: operationsDecision }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { error: 'Failed to generate task list' },
      { status: 500 }
    )
  }
}
