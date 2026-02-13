import * as z from "zod";

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  profileType: z.string(),
  externalProfileId: z.string().optional(),
  name: z.string().optional(),
  interestVector: z.array(z.number()).optional(),
  preferences: z
    .object({
      diversity_weight: z.number().optional(),
      novelty_weight: z.number().optional(),
    })
    .optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
