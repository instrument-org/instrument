export interface ImageSize {
  height: number;
  width: number;
}

/**
 * How large an image is shown to a model, in patches and in pixels.
 *
 * Providers bill and sample images in square patches, so a budget has two
 * halves: a cap on the longest edge and a cap on the total patch count.
 */
export interface ImageViewLimits {
  maxEdge: number;
  maxPatches: number;
  patchSize: number;
}

/**
 * The one size every image is previewed at, for every provider and every model.
 *
 * Fixed on purpose, and the reason is the coordinate contract rather than
 * simplicity. A region read names a pixel space in text and hands over bytes to
 * match; if that space were derived from the active model, then switching models
 * mid-session would silently redefine the coordinates every earlier message was
 * written in, and no message can be reinterpreted after the fact.
 *
 * These numbers are the smallest budget any provider we support is known to
 * render at. A model with a larger budget therefore sees no more of the image on
 * first look than the floor allows, which is the price of a stable space -- and
 * a cheap one, because a `region` read goes back to the full-resolution file for
 * the detail. Raising this per model would reintroduce exactly the instability
 * above, so it needs a different answer to coordinate stability first, not just
 * better numbers.
 */
export const PREVIEW_LIMITS: ImageViewLimits = {
  maxEdge: 1568,
  maxPatches: 1568,
  patchSize: 28,
};

/**
 * Patches an image of this size costs the provider, one per patchSize square.
 */
export function imagePatchCount({
  height,
  limits,
  width,
}: {
  height: number;
  limits: ImageViewLimits;
  width: number;
}) {
  return (
    Math.ceil(width / limits.patchSize) * Math.ceil(height / limits.patchSize)
  );
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
  limits: ImageViewLimits;
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
  limits: ImageViewLimits;
  width: number;
}) {
  const { maxEdge, maxPatches, patchSize } = limits;
  return (
    Math.ceil(width / patchSize) * patchSize <= maxEdge &&
    Math.ceil(height / patchSize) * patchSize <= maxEdge &&
    imagePatchCount({ height, limits, width }) <= maxPatches
  );
}
