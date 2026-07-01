// Disclosure copy for the AI-processing consent modal, separated from the
// component so it can be unit-tested. Apple 5.1.1(i)/5.1.2(i) requires the
// consent text to accurately describe what is sent for the CURRENT flow:
//  - 'tryon' sends your photo(s) + a prompt and returns a generated image
//  - 'video' sends the source image(s) + a motion prompt and returns a video
export type AiConsentMode = 'tryon' | 'video';

export interface AiConsentCopy {
  /** Lead-in before "xAI, Inc., operator of the Grok Imagine API:". */
  actionPhrase: string;
  /** What is sent — rendered as a bullet list. */
  bullets: string[];
  /** What xAI does with it, before the privacy-policy links. */
  outputPhrase: string;
}

export function getAiConsentCopy(mode: AiConsentMode): AiConsentCopy {
  if (mode === 'video') {
    return {
      actionPhrase: 'To animate your photo into a video, this app sends the following to',
      bullets: [
        'The image(s) you choose to animate (a photo from your library or a past creation)',
        'The motion prompt you type describing the movement',
      ],
      outputPhrase:
        'xAI processes these solely to return the generated video and handles them under its own',
    };
  }
  return {
    actionPhrase: 'To generate your image, this app sends the following to',
    bullets: [
      'The photo(s) you provide for this generation',
      'The text prompt you type describing what to create',
    ],
    outputPhrase:
      'xAI processes these solely to return the generated image and handles them under its own',
  };
}
