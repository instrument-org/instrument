import { platformApiRpcClient } from "@/electron-main/platform-api/client";
import { authenticated } from "@/electron-main/rpc/base";
import { z } from "zod";

const createCheckoutSession = authenticated
  .input(z.object({ priceId: z.string() }))
  .handler(async ({ input }) =>
    platformApiRpcClient.stripe.createCheckoutSession.call(input),
  );

const createLifetimeCheckoutSession = authenticated
  .input(z.void())
  .handler(async () =>
    platformApiRpcClient.stripe.createLifetimeCheckoutSession.call(),
  );

const createPortalSession = authenticated
  .input(z.void())
  .handler(async () => platformApiRpcClient.stripe.createPortalSession.call());

const getInvoicePreview = authenticated
  .input(z.object({ priceId: z.string() }))
  .handler(async ({ input }) =>
    platformApiRpcClient.stripe.getInvoicePreview.call(input),
  );

export const stripe = {
  createCheckoutSession,
  createLifetimeCheckoutSession,
  createPortalSession,
  getInvoicePreview,
};
