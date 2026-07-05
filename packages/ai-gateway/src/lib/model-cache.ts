import { type AIGatewayModel } from "../schemas/model";

export interface ModelCache {
  read(cacheIdentifier: string): AIGatewayModel.Type[] | undefined;
  write(cacheIdentifier: string, models: AIGatewayModel.Type[]): void;
}

export const noopModelCache: ModelCache = {
  read() {
    return;
  },
  write() {
    return;
  },
};
