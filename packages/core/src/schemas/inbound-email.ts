import { z } from "zod";

export const inboundEmailSchema = z.object({
  messageId: z.string().min(1),
  subject: z.string().default(""),
  senderEmail: z.email(),
  senderName: z.string().min(1),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
});

export type InboundEmail = z.infer<typeof inboundEmailSchema>;
