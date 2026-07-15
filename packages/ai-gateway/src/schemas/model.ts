import { z } from "zod";

import { AIGatewayModelURI } from "./model-uri";

export namespace AIGatewayModel {
  export const ProviderIdSchema = z
    .string()
    .brand<"AIGatewayProviderModelId">();
  export type ProviderId = z.output<typeof ProviderIdSchema>;

  export const ModelTagSchema = z.enum([
    "coding",
    "default",
    "legacy",
    "recommended",
    "new",
    "exacto",
  ]);
  export type ModelTag = z.output<typeof ModelTagSchema>;

  /**
   * Drops tags this build does not recognize rather than rejecting the model.
   * Assistant messages persist a snapshot of their model's tags, so a task
   * recorded by another build can name a tag that has since been retired, and
   * a strict enum would fail the parse for every message in that session over
   * a label nothing reads back. Tags are descriptive, so dropping one costs a
   * badge; refusing the message costs the transcript.
   */
  const ModelTagsSchema = z
    .array(z.string())
    .transform((tags) =>
      tags.filter(
        (tag): tag is ModelTag => ModelTagSchema.safeParse(tag).success,
      ),
    );
  export const ModelFeaturesSchema = z.enum([
    "inputAudio",
    "inputFile",
    "inputImage",
    "inputText",
    "inputVideo",
    "outputText",
    "tools",
  ]);
  export type ModelFeatures = z.output<typeof ModelFeaturesSchema>;

  export const CanonicalIdSchema = AIGatewayModelURI.CanonicalIdSchema;
  export type CanonicalId = z.output<typeof CanonicalIdSchema>;

  /**
   * Set by the gateway when the signed-in user cannot run this model, and
   * absent otherwise. Deciding that is the server's job, so treat this as the
   * answer rather than re-deriving one: render `message` as-is, and keep
   * `reason` an open string so a policy can name a criterion this client has
   * never heard of without failing to parse.
   */
  export const RestrictionSchema = z.object({
    message: z.string(),
    reason: z.string(),
  });
  export type Restriction = z.output<typeof RestrictionSchema>;

  export const Schema = z.object({
    author: z.string(),
    canonicalId: AIGatewayModelURI.CanonicalIdSchema,
    features: ModelFeaturesSchema.array(),
    name: z.string(),
    params: AIGatewayModelURI.ParamsSchema,
    providerId: ProviderIdSchema,
    providerName: z.string(),
    restricted: RestrictionSchema.optional(),
    tags: ModelTagsSchema,
    uri: AIGatewayModelURI.Schema,
  });

  export type Type = z.output<typeof Schema>;
}
