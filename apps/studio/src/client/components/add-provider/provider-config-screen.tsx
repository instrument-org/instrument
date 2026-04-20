import { providerMetadataAtom } from "@/client/atoms/provider-metadata";
import { Button } from "@/client/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { fixURL } from "@/client/lib/fix-url";
import { rpcClient } from "@/client/rpc/client";
import { type ClientAIProviderConfig } from "@/shared/schemas/provider";
import {
  AI_GATEWAY_API_KEY_NOT_NEEDED,
  type AIProviderType,
} from "@instrument-org/shared";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { AlertCircle, Lock } from "lucide-react";
import { type ReactNode, useReducer, useRef, useState } from "react";

import { ProviderPicker } from "../provider-picker";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Alert, AlertDescription } from "../ui/alert";
import { ProviderLinks } from "./provider-links";

type AddProviderAction =
  | {
      allowBypass: boolean;
      message: string;
      type: "SET_ERROR";
      validationFailed: boolean;
    }
  | {
      baseURL?: string;
      displayName?: string;
      providerType: AIProviderType;
      type: "SELECT_PROVIDER";
    }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_API_KEY"; value: string }
  | { type: "SET_BASE_URL"; value: string }
  | { type: "SET_DISPLAY_NAME"; value: string };

interface AddProviderState {
  allowBypass: boolean;
  apiKey: string;
  baseURL: string;
  displayName: string;
  errorMessage: null | string;
  selectedProviderType: AIProviderType | undefined;
  validationFailed: boolean;
}

const initialState: AddProviderState = {
  allowBypass: false,
  apiKey: "",
  baseURL: "",
  displayName: "",
  errorMessage: null,
  selectedProviderType: undefined,
  validationFailed: false,
};

export function ProviderConfigScreen({
  onSuccess,
  providers,
}: {
  onSuccess: () => void;
  providers: ClientAIProviderConfig[];
}) {
  const { providerMetadataMap } = useAtomValue(providerMetadataAtom);
  const [state, dispatch] = useReducer(addProviderReducer, initialState);
  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState<string | undefined>(
    undefined,
  );

  const createMutation = useMutation(
    rpcClient.providerConfig.create.mutationOptions(),
  );

  const providerMetadata = state.selectedProviderType
    ? providerMetadataMap.get(state.selectedProviderType)
    : undefined;

  const requiresAPIKey = providerMetadata?.requiresAPIKey ?? true;
  const isOpenAICompatible = state.selectedProviderType === "openai-compatible";

  const isSecondProviderOfSameType = state.selectedProviderType
    ? providers.some((p) => p.type === state.selectedProviderType)
    : false;

  const hasSelectedProvider = state.selectedProviderType !== undefined;
  const hasAPIKey = !requiresAPIKey || Boolean(state.apiKey.trim());
  const hasValidBaseURL = Boolean(state.baseURL.trim());

  const isFormValid = hasSelectedProvider && hasAPIKey && hasValidBaseURL;

  const handleApiKeyChange = (value: string) => {
    dispatch({ type: "SET_API_KEY", value });
  };

  const handleBaseURLChange = (value: string) => {
    dispatch({ type: "SET_BASE_URL", value });
  };

  const handleDisplayNameChange = (value: string) => {
    dispatch({ type: "SET_DISPLAY_NAME", value });
  };

  const renderDisplayNameField = (description: ReactNode) =>
    providerMetadata && (
      <LabeledField
        description={description}
        htmlFor="display-name"
        label="Name"
      >
        <Input
          id="display-name"
          onChange={(e) => {
            handleDisplayNameChange(e.target.value);
          }}
          placeholder={`E.g. My ${providerMetadata.name}`}
          ref={displayNameInputRef}
          spellCheck={false}
          type="text"
          value={state.displayName}
        />
      </LabeledField>
    );

  const renderBaseURLField = ({
    description,
    placeholder,
  }: {
    description: ReactNode;
    placeholder: string;
  }) => (
    <LabeledField description={description} htmlFor="base-url" label="Base URL">
      <Input
        className="font-mono"
        id="base-url"
        onChange={(e) => {
          handleBaseURLChange(e.target.value);
        }}
        placeholder={placeholder}
        spellCheck={false}
        type="text"
        value={state.baseURL}
      />
    </LabeledField>
  );

  const handleProviderSelect = (providerType: AIProviderType | undefined) => {
    if (providerType) {
      const selectedProviderMetadata = providerMetadataMap.get(providerType);
      const hasExistingProvider = providers.some(
        (p) => p.type === providerType,
      );

      const shouldSetDefaultDisplayName =
        providerType !== "openai-compatible" && !hasExistingProvider;

      const displayName = shouldSetDefaultDisplayName
        ? (selectedProviderMetadata?.name ?? "")
        : "";

      const baseURL = selectedProviderMetadata?.api.defaultBaseURL ?? "";

      dispatch({
        baseURL,
        displayName,
        providerType,
        type: "SELECT_PROVIDER",
      });

      if (hasExistingProvider && providerType !== "openai-compatible") {
        setAdvancedOpen("advanced");
      } else {
        setAdvancedOpen(undefined);
      }

      setTimeout(() => {
        if (shouldSetDefaultDisplayName) {
          apiKeyInputRef.current?.focus();
        } else {
          displayNameInputRef.current?.focus();
        }
      }, 0);
    }
  };

  const handleSave = async (skipValidation = false) => {
    if (!state.selectedProviderType) {
      return;
    }

    const defaultBaseURL = providerMetadata?.api.defaultBaseURL ?? "";

    let baseURLToSave: string | undefined;

    if (state.baseURL.trim()) {
      const normalizedBaseURL = fixURL(state.baseURL);
      if (normalizedBaseURL !== state.baseURL) {
        dispatch({
          type: "SET_BASE_URL",
          value: normalizedBaseURL,
        });
      }
      // Only save the base URL if the user modified it from the default.
      // This allows us to update defaults in the future without affecting
      // existing configurations.
      if (normalizedBaseURL !== defaultBaseURL) {
        baseURLToSave = normalizedBaseURL;
      }
    }

    try {
      await createMutation.mutateAsync(
        {
          config: {
            apiKey: requiresAPIKey
              ? state.apiKey
              : AI_GATEWAY_API_KEY_NOT_NEEDED,
            baseURL: baseURLToSave,
            displayName: state.displayName.trim() || undefined,
            type: state.selectedProviderType,
          },
          skipValidation,
        },
        {
          onError: (error) => {
            if (isDefinedError(error)) {
              const isBadRequest = error.code === "BAD_REQUEST";
              dispatch({
                allowBypass: !isBadRequest,
                message: error.message,
                type: "SET_ERROR",
                validationFailed: true,
              });
            } else {
              dispatch({
                allowBypass: false,
                message: "Failed to validate provider",
                type: "SET_ERROR",
                validationFailed: true,
              });
            }
          },
        },
      );
      onSuccess();
    } catch {
      // Handled in onError
    }
  };

  const saving = createMutation.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Add Provider
        </DialogTitle>
        <DialogDescription>
          {state.selectedProviderType && providerMetadata
            ? providerMetadata.description
            : "Select a provider to add for AI model usage."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-y-3 py-3">
        <div className="flex flex-col gap-y-1">
          <Label>Provider</Label>
        </div>

        <ProviderPicker
          onSelect={handleProviderSelect}
          selectedProvider={state.selectedProviderType}
        />

        {state.selectedProviderType && providerMetadata && (
          <>
            {isOpenAICompatible && (
              <>
                {renderDisplayNameField(
                  "Custom name to identify this provider",
                )}
                {renderBaseURLField({
                  description:
                    "The base URL of your OpenAI-compatible endpoint",
                  placeholder: "E.g. https://api.example.com/v1",
                })}
              </>
            )}

            {requiresAPIKey ? (
              <>
                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="api-key">API Key</Label>
                  {!isOpenAICompatible && (
                    <ProviderLinks
                      keyURL={providerMetadata.api.keyURL}
                      name={providerMetadata.name}
                      url={providerMetadata.url}
                    />
                  )}
                </div>

                <Input
                  className="font-mono"
                  id="api-key"
                  onChange={(e) => {
                    handleApiKeyChange(e.target.value);
                  }}
                  placeholder={`${providerMetadata.api.keyFormat ?? ""}...xyz123`}
                  ref={apiKeyInputRef}
                  spellCheck={false}
                  type="text"
                  value={state.apiKey}
                />

                <Alert>
                  <Lock className="size-4" />
                  <AlertDescription className="text-xs">
                    Your API key is encrypted and stored locally on your
                    computer.
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <ProviderLinks
                name={providerMetadata.name}
                url={providerMetadata.url}
              />
            )}

            {!isOpenAICompatible && (
              <Accordion
                collapsible
                onValueChange={setAdvancedOpen}
                type="single"
                value={advancedOpen}
              >
                <AccordionItem className="border-b-0" value="advanced">
                  <AccordionTrigger className="justify-start gap-1.5 py-3 text-xs font-normal text-muted-foreground">
                    Advanced
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-y-3">
                      {renderDisplayNameField(
                        isSecondProviderOfSameType
                          ? "Custom name to distinguish this provider from others of the same type"
                          : "Custom name to identify this provider",
                      )}
                      {renderBaseURLField({
                        description: (
                          <>
                            Only change this if you know what you&apos;re doing.{" "}
                            Use the{" "}
                            <span
                              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                              onClick={() => {
                                handleProviderSelect("openai-compatible");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleProviderSelect("openai-compatible");
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              OpenAI-compatible provider
                            </span>{" "}
                            if you want to add a custom OpenAI-compatible
                            provider.
                          </>
                        ),
                        placeholder: providerMetadata.api.defaultBaseURL,
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </>
        )}

        {state.errorMessage && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="flex flex-col gap-2">
              <div>{state.errorMessage}</div>
              {state.validationFailed && state.allowBypass && (
                <Button
                  className="w-fit"
                  onClick={() => handleSave(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Add anyway
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <DialogFooter className="flex gap-2">
        <Button disabled={saving || !isFormValid} type="submit">
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function addProviderReducer(
  state: AddProviderState,
  action: AddProviderAction,
): AddProviderState {
  switch (action.type) {
    case "CLEAR_ERROR": {
      return {
        ...state,
        allowBypass: false,
        errorMessage: null,
        validationFailed: false,
      };
    }

    case "SELECT_PROVIDER": {
      return {
        ...state,
        allowBypass: false,
        baseURL: action.baseURL ?? "",
        displayName: action.displayName ?? "",
        errorMessage: null,
        selectedProviderType: action.providerType,
        validationFailed: false,
      };
    }

    case "SET_API_KEY": {
      return {
        ...state,
        allowBypass: false,
        apiKey: action.value,
        errorMessage: null,
        validationFailed: false,
      };
    }

    case "SET_BASE_URL": {
      return {
        ...state,
        allowBypass: false,
        baseURL: action.value,
        errorMessage: null,
        validationFailed: false,
      };
    }

    case "SET_DISPLAY_NAME": {
      return {
        ...state,
        displayName: action.value,
      };
    }

    case "SET_ERROR": {
      return {
        ...state,
        allowBypass: action.allowBypass,
        errorMessage: action.message,
        validationFailed: action.validationFailed,
      };
    }

    default: {
      return state;
    }
  }
}

function LabeledField({
  children,
  description,
  htmlFor,
  label,
}: {
  children: ReactNode;
  description?: ReactNode;
  htmlFor: string;
  label: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-y-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      {children}
    </>
  );
}
