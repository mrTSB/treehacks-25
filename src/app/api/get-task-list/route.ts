import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from "zod"
import { zodResponseFormat } from "openai/helpers/zod"

type Operation = {
    name: string;
    description: string;
    trimming_guidance?: string;
    user_description: string;
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
  generate_podcast_clip: z.boolean(),
  extend_video: z.boolean(),
  apply_filters: z.boolean(),
})

/**
 * POST method for get-task-list.
 * This endpoint takes a user prompt that instructs the assistant which video editing 
 * operations should be performed. The assistant returns a structured response with an 
 * array of objects, each identifying an operation and whether it should be performed.
 */
export async function POST(request: Request) {
  try {
    const { userPrompt, videoInformation } = await request.json()

    // Define the complete list of available operations.
    const taskList: Operation[] = [
      {
        name: 'generate_visuals',
        description: 'Generate new visuals for the video with a text-to-video model.',
        user_description: 'I will create new visual content for your video using AI technology, transforming your ideas into engaging visuals.'
      },
      {
        name: 'generate_text_overlay',
        description: 'Generate a text overlay for the video.',
        user_description: 'I will add text overlays to your video, such as captions, titles, or key information that enhances your video.'
      },
      {
        name: 'remove_unnecessary_audio',
        description: 'Look for any audio that is repeated or not needed and remove it.',
        user_description: 'I will clean up your audio by removing any redundant sounds, silence, or unwanted background noise.'
      },
      {
        name: 'trim_based_on_visuals',
        description: 'Analyze the video frames and remove unnecessary parts.',
        user_description: 'I will analyze your video content and trim accordingly.'
      },
      {
        name: 'add_background_music',
        description: 'Add background music to the video.',
        user_description: 'I will add appropriate background music to enhance the mood and engagement of your video.'
      },
      {
        name: 'generate_voiceover',
        description: 'Generate a voiceover for the video.',
        user_description: 'I will create a professional AI voiceover narration for your video content.'
      },
      {
        name: 'adjust_audio_levels',
        description: 'Adjust the audio levels of the video.',
        user_description: 'I will balance all audio elements (music, voice, effects) to ensure clear and professional sound quality.'
      },
      {
        name: 'add_sound_effects',  
        description: 'Add sound effects to the video.',
        user_description: 'I will enhance your video with appropriate sound effects to create a more immersive experience.'
      },
      {
        name: 'generate_podcast_clip',
        description: 'Generate a podcast-style clip for the video.',
        user_description: 'I will create a podcast-style clip for your video content.'
      },
      {
        name: 'extend_video',
        description: 'Extend the video with a prompt and then stitch it to the original video.',
        user_description: 'I will generate extra content for the video.'
      },
      {
        name: 'apply_filters',
        description: 'Apply filters to the video.',
        user_description: 'I will apply filters to the video to enhance the video quality.'
      }
    ]

    // Initialize the OpenAI client.
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })

    let tasksToPerform: Operation[] = []
    let attempts = 0;
    let isCorrect = false;

    while (attempts < 5 && !isCorrect) {
      // Create messages that include the full list of available operations and video information
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: `You are a video editing assistant.
          Based on the user's prompt, decide which ONE operation is MOST relevant and should be performed.
          All other operations should be marked as false.
          Return a JSON array of objects with two keys:
          "operation_name": a string corresponding to one of the following operations: ${taskList.map(t => t.name).join(', ')},
          "perform": a boolean indicating whether the operation should be performed.
          IMPORTANT: Only ONE operation should be marked as true.`
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

      // Clear previous tasks
      tasksToPerform = []
      for (const task of taskList) {
        if (operationsDecision && operationsDecision[task.name as keyof typeof operationsDecision]) {
          tasksToPerform.push(task)
        }
      }

      // Modify verification prompt to check for single operation
      const verificationMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: `You are a verification assistant. Review if the selected single video editing operation is the most relevant for the user's request. 
          Return only "true" if the operation is the most appropriate choice, or "false" if a different operation would be more suitable.
          Remember: There should be exactly ONE operation selected.`
        },
        {
          role: "user",
          content: `User prompt: "${userPrompt}"
          Selected operation: ${tasksToPerform.map(t => t.name).join(', ')}
          
          Is this the most appropriate single operation? Reply with only true or false.`
        }
      ]

      const verificationResponse = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: verificationMessages,
        temperature: 0.2,
      })

      const verificationResult = verificationResponse.choices[0].message.content?.toLowerCase()
      isCorrect = verificationResult === 'true'
      attempts++

      if (!isCorrect && attempts < 5) {
        console.log(`Attempt ${attempts}: Verification failed, regenerating...`)
        continue
      }
    }

    if (attempts === 5 && !isCorrect) {
      console.log('Maximum attempts reached, returning last result despite verification failure')
    }

    // Add trimming guidance after verification
    console.log('tasksToPerform', tasksToPerform)
    for (const task of tasksToPerform) {
      if (task.name === 'trim_based_on_visuals') {
        console.log('Generating trim guidance for trim_based_on_visuals task...');
        const trimResponse = await client.chat.completions.create({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: `You are a video editing assistant specialized in identifying optimal trim points in videos.
              Your task is to analyze the video timeline and user request to identify sections that should be removed.
              Look for:
              - Redundant or repetitive content
              - Low-quality or irrelevant sections
              - Sections that don't align with the user's intent
              
              You MUST return exactly two timestamps in the format "HH:MM:SS, HH:MM:SS" where:
              - First timestamp is where to start cutting
              - Second timestamp is where to end cutting
              - Everything between these timestamps will be removed
              - Timestamps must align with 0.5 second intervals (e.g., 00:00:00, 00:00:00.5, 00:01:00, etc.)
              
              Example valid response: "00:00:05, 00:00:15.5"
              
              You must identify some points to trim, if you are struggling, make sure to only trim a very small irrelevant section of the video.
              
              IMPORTANT: Return ONLY the timestamps with no additional text or explanation.`
            },
            {
              role: "user",
              content: `User request: "${userPrompt}"
              
              Video timeline information (captured every 0.5 seconds):
              ${JSON.stringify(videoInformation, null, 2)}
              
              Based on this information, provide the exact timestamps (HH:MM:SS, HH:MM:SS) for the section that should be removed.`
            }
          ],
          temperature: 0.7,
        })
        
        const timestampResponse = trimResponse.choices[0].message.content || "";
        const timestampRegex = /^(\d{2}:\d{2}:\d{2}(\.\d)?),\s*(\d{2}:\d{2}:\d{2}(\.\d)?)$/;
        
        console.log('GPT Timestamp Response:', timestampResponse);
        
        if (timestampResponse === "UNABLE_TO_DETERMINE_TRIM_POINTS") {
          console.log('Unable to determine trim points from user request');
          task.trimming_guidance = undefined;
        } else if (timestampRegex.test(timestampResponse)) {
          task.trimming_guidance = timestampResponse;
          console.log(`Trim guidance for ${task.name}: ${timestampResponse}`);
        } else {
          console.error('Invalid timestamp format received:', timestampResponse);
          task.trimming_guidance = undefined;
        }
      }
    }

    return NextResponse.json({ tasks: tasksToPerform }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { error: 'Failed to generate task list' },
      { status: 500 }
    )
  }
}
