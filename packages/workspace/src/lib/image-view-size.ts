import {
  getProviderMetadata,
  type ProviderImageView,
} from "@instrument-org/ai-gateway";
import { type AIProviderType } from "@instrument-org/shared";

export interface ImageSize {
  height: number;
  width: number;
}

/**
 * Patches an image of this size costs the provider, one per patchSize square.
 */
export function imagePatchCount({
  height,
  limits,
  width,
}: {
  height: number;
  limits: ProviderImageView;
  width: number;
}) {
  return (
    Math.ceil(width / limits.patchSize) * Math.ceil(height / limits.patchSize)
  );
}

export function imageViewLimits(provider: AIProviderType): ProviderImageView {
  return getProviderMetadata(provider).imageView;
}

/**
 * The largest size within the provider's image budget that preserves the aspect
 * ratio. An image already inside the budget comes back unchanged.
 *
 * A provider silently downscales anything over its budget before the model sees
 * it, so this is the size the model actually looks at. Doing the same resize
 * ourselves is what makes the pixel coordinates the model reports line up with
 * the image we hold.
 *
 * Also serves as the upscale target for a magnified crop: feed it a size far
 * past the budget and the search comes back down to the largest size that fits,
 * which is the most patches the crop's contents can be spread across.
 */
export function imageViewSize({
  height,
  limits,
  width,
}: {
  height: number;
  limits: ProviderImageView;
  width: number;
}): ImageSize {
  if (width < 1 || height < 1) {
    return { height: Math.max(1, height), width: Math.max(1, width) };
  }
  if (fitsBudget({ height, limits, width })) {
    return { height, width };
  }
  if (height > width) {
    const flipped = imageViewSize({ height: width, limits, width: height });
    return { height: flipped.width, width: flipped.height };
  }

  // Binary search the long edge. `low` always fits and `high` never does, so the
  // loop converges on the largest width whose matching height is still inside
  // the budget. A closed form gets close but lands off by a patch either way,
  // and "off by a patch" here means the provider resizes again behind us.
  const aspectRatio = width / height;
  const heightFor = (candidate: number) =>
    Math.max(1, Math.round(candidate / aspectRatio));
  let low = 1;
  let high = width;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (fitsBudget({ height: heightFor(middle), limits, width: middle })) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return { height: heightFor(low), width: low };
}

function fitsBudget({
  height,
  limits,
  width,
}: {
  height: number;
  limits: ProviderImageView;
  width: number;
}) {
  const { maxEdge, maxPatches, patchSize } = limits;
  return (
    Math.ceil(width / patchSize) * patchSize <= maxEdge &&
    Math.ceil(height / patchSize) * patchSize <= maxEdge &&
    imagePatchCount({ height, limits, width }) <= maxPatches
  );
}
