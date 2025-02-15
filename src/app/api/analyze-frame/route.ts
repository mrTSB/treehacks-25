import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Sleep function for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Function to generate content with retry logic
async function generateContentWithRetry(model: any, prompt: string, imagePart: any, maxRetries = 3) {
  let lastError;
  let delay = 1000; // Start with 1 second delay

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1}/${maxRetries} to generate content`);
      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      console.log('Successfully generated description:', text);
      return text;
    } catch (error: any) {
      lastError = error;
      console.error(`Attempt ${attempt + 1} failed:`, error.message);
      
      // If it's a rate limit error (429), wait and retry
      if (error.message.includes('429')) {
        console.log(`Rate limit hit. Waiting ${delay}ms before retry...`);
        await sleep(delay);
        delay *= 2; // Exponential backoff
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
  
  throw lastError;
}

export async function POST(request: Request) {
  try {
    const { image } = await request.json();

    if (!image) {
      console.log('Missing image data in request');
      return NextResponse.json(
        { error: 'Missing image data' },
        { status: 400 }
      );
    }

    console.log('Processing new frame...');

    // Remove the data URL prefix to get just the base64 data
    const base64Data = image.split(',')[1];

    // Convert base64 to Uint8Array
    const imageData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    // Get the Gemini 1.5 Flash model
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    console.log('Using Gemini model: gemini-1.5-flash');

    // Create image part from binary data
    const imagePart = {
      inlineData: {
        data: Buffer.from(imageData).toString('base64'),
        mimeType: 'image/jpeg'
      },
    };

    // Generate content from image with retry logic
    console.log('Sending frame to Gemini API...');
    const description = await generateContentWithRetry(
      model,
      'Describe what is happening in this video frame in a concise sentence.',
      imagePart
    );

    console.log('Successfully processed frame');
    return NextResponse.json({ description });
  } catch (error) {
    console.error('Error analyzing frame:', error);
    return NextResponse.json(
      { error: 'Error analyzing frame' },
      { status: 500 }
    );
  }
} 