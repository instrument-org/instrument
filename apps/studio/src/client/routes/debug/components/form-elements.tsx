import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/client/components/ui/accordion";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Input } from "@/client/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/client/components/ui/input-group";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import { Textarea } from "@/client/components/ui/textarea";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/form-elements")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug form elements" }],
  }),
});

/** The variants the app draws a button in somewhere. */
const buttonVariants = [
  "default",
  "brand",
  "secondary",
  "outline",
  "outline-opaque",
  "ghost",
  "ghost-toolbar",
  "destructive",
  "ghost-destructive",
  "link",
  "input-select",
] as const;

const buttonSizes = ["xs", "sm", "default", "lg"] as const;

const buttonIconSizes = ["icon-sm", "icon"] as const;

/** The variants the app draws a badge in somewhere. */
const badgeVariants = ["secondary", "outline", "destructive"] as const;

function Gallery({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="border-b border-black/5 pb-1.5 text-xs font-medium text-muted-foreground dark:border-white/10">
        {label}
      </p>
      {children}
    </div>
  );
}

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Form elements
          </h1>
          <p className="text-sm text-muted-foreground">
            The app&rsquo;s form controls, in the variants it uses. Tab through
            them with the keyboard to check that each focus ring hugs its
            rounded corners and never clips against the edge of its container.
          </p>
        </header>

        <Section
          description="A single line of text, with its invalid and disabled states."
          title="Input"
        >
          <div className="flex flex-col gap-3">
            <Input placeholder="Default input" />
            <Input aria-invalid placeholder="Invalid input" />
            <Input disabled placeholder="Disabled input" />
          </div>
        </Section>

        <Section
          description="Several lines of text. It grows with what is typed until it reaches its cap, then scrolls."
          title="Textarea"
        >
          <div className="flex flex-col gap-3">
            <Textarea placeholder="Default textarea" />
            <Textarea
              className="max-h-40 overflow-y-auto"
              defaultValue={Array.from(
                { length: 12 },
                (_, i) => `Line ${i + 1} of capped, scrollable content.`,
              ).join("\n")}
            />
          </div>
        </Section>

        <Section
          description="The browser's address bar. Its button shows when you point at the field or type in it."
          title="Input group"
        >
          <InputGroup className="h-8 rounded-lg border border-input from-transparent to-transparent shadow-none dark:bg-transparent">
            <InputGroupInput
              className="h-full bg-none text-ellipsis dark:border-0"
              placeholder="Enter a URL or search"
              spellCheck={false}
            />
            <InputGroupAddon
              align="inline-end"
              className="hidden group-focus-within/input-group:flex group-hover/input-group:flex"
            >
              <InputGroupButton
                aria-label="Open in external browser"
                size="icon-xs"
              >
                <ArrowSquareOutIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Section>

        <Section
          description="A dropdown that picks one option from a list."
          title="Select"
        >
          <Select>
            <SelectTrigger aria-label="Fruit">
              <SelectValue placeholder="Pick a fruit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apple">Apple</SelectItem>
              <SelectItem value="banana">Banana</SelectItem>
              <SelectItem value="cherry">Cherry</SelectItem>
            </SelectContent>
          </Select>
        </Section>

        <Section title="Button">
          <div className="flex flex-col gap-8">
            <Gallery label="variants">
              <div className="flex flex-wrap gap-2">
                {buttonVariants.map((variant) => (
                  <Button key={variant} variant={variant}>
                    {variant}
                  </Button>
                ))}
              </div>
            </Gallery>
            <Gallery label="sizes">
              <div className="flex flex-col gap-3">
                {buttonSizes.map((size) => (
                  <SizeRow key={size} size={size}>
                    <Button size={size}>Button</Button>
                    <Button size={size}>
                      <CheckIcon />
                      Button
                    </Button>
                  </SizeRow>
                ))}
              </div>
            </Gallery>
            <Gallery label="icon">
              <div className="flex flex-col gap-3">
                {buttonIconSizes.map((size) => (
                  <SizeRow key={size} size={size}>
                    <Button size={size}>
                      <CheckIcon />
                    </Button>
                  </SizeRow>
                ))}
              </div>
            </Gallery>
          </div>
        </Section>

        <Section
          description="Badges are usually static, but one drawn as a link or button takes focus."
          title="Badge"
        >
          <div className="flex flex-wrap gap-3">
            {badgeVariants.map((variant) => (
              <Badge asChild key={variant} variant={variant}>
                <button type="button">{variant}</button>
              </Badge>
            ))}
          </div>
        </Section>

        <Section title="Checkbox">
          <div className="flex flex-col gap-3">
            <Label className="flex items-center gap-2">
              <Checkbox defaultChecked />
              Checked
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox />
              Unchecked
            </Label>
            <Label className="flex items-center gap-2 opacity-60">
              <Checkbox disabled />
              Disabled
            </Label>
          </div>
        </Section>

        <Section title="Switch">
          <div className="flex flex-col gap-3">
            <Label className="flex items-center gap-2">
              <Switch defaultChecked />
              On
            </Label>
            <Label className="flex items-center gap-2">
              <Switch />
              Off
            </Label>
          </div>
        </Section>

        <Section
          description="Each tab shows the focus ring when you tab to it."
          title="Tabs"
        >
          <Tabs className="w-full" defaultValue="account">
            <TabsList>
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="password">Password</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
            </TabsList>
            <TabsContent
              className="pt-3 text-sm text-muted-foreground"
              value="account"
            >
              Account panel content.
            </TabsContent>
            <TabsContent
              className="pt-3 text-sm text-muted-foreground"
              value="password"
            >
              Password panel content.
            </TabsContent>
            <TabsContent
              className="pt-3 text-sm text-muted-foreground"
              value="team"
            >
              Team panel content.
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Accordion">
          <Accordion collapsible type="single">
            <AccordionItem value="one">
              <AccordionTrigger>First section</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                First section content.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="two">
              <AccordionTrigger>Second section</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                Second section content.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>
      </div>
    </div>
  );
}

function Section({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SizeRow({
  children,
  size,
}: {
  children: React.ReactNode;
  size: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-18 shrink-0 font-mono text-xs text-muted-foreground">
        {size}
      </span>
      {children}
    </div>
  );
}
