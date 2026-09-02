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

  /**
   * What the model does about thinking, when the provider says anything at all.
   *
   * `efforts` holds the provider's own words rather than ours, and stays an
   * open string list because there is no vocabulary to write down: across the
   * models that name their levels there are more than twenty distinct sets,
   * from `high,medium,low` to a model whose only level is `high`. An enum would
   * be wrong for most of them the day it was written.
   *
   * `mandatory` means the model thinks whether or not we ask, so a level of
   * none is not reachable. `enabledByDefault` is the weaker form: it thinks
   * unless told otherwise.
   */
  export const ReasoningSchema = z.object({
    defaultEffort: z.string().optional(),
    efforts: z.array(z.string()),
    enabledByDefault: z.boolean(),
    mandatory: z.boolean(),
  });
  export type Reasoning = z.output<typeof ReasoningSchema>;

  export const Schema = z.object({
    author: z.string(),
    canonicalId: AIGatewayModelURI.CanonicalIdSchema,
    /**
     * Tokens the model accepts in one request, when the provider tells us.
     *
     * Optional because most provider model endpoints omit it: only
     * OpenRouter-shaped responses (`context_length`, which covers our own
     * gateway) and Google (`inputTokenLimit`) carry one. Absent means unknown,
     * and every consumer treats unknown as "do not act" rather than
     * substituting a guess. Guessing low is the harmful direction, since it
     * would spend a session's remaining room on a limit the model does not
     * have.
     */
    contextLength: z.number().int().positive().optional(),
    features: ModelFeaturesSchema.array(),
    name: z.string(),
    params: AIGatewayModelURI.ParamsSchema,
    providerId: ProviderIdSchema,
    providerName: z.string(),
    /**
     * Optional for the reason `contextLength` is: only OpenRouter-shaped
     * responses carry it, and absent means unknown rather than none.
     */
    reasoning: ReasoningSchema.optional(),
    restricted: RestrictionSchema.optional(),
    tags: ModelTagsSchema,
    uri: AIGatewayModelURI.Schema,
  });

  export type Type = z.output<typeof Schema>;
}
