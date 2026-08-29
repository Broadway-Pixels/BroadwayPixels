export function verificationMessage(options: {
  to: string;
  verificationUrl: string;
  from?: string;
}): EmailMessageBuilder;

export function sendVerificationEmail(relay: Fetcher, relaySecret: string, options: {
  to: string;
  verificationUrl: string;
  from?: string;
}): Promise<{ sent: true; id?: string }>;
