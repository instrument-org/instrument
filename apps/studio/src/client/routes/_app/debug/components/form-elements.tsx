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
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Slider } from "@/client/components/ui/slider";
import { Switch } from "@/client/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/client/components/ui/tabs";
import { Textarea } from "@/client/components/ui/textarea";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/debug/components/form-elements")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug form elements" }],
  }),
});

const buttonVariants = [
  "default",
  "brand",
  "secondary",
  "outline",
  "outline-muted",
  "ghost",
  "destructive",
  "ghost-destructive",
  "link",
  "input-select",
] as const;

const badgeVariants = [
  "default",
  "brand",
  "brand-outline",
  "secondary",
  "outline",
  "destructive",
  "success",
  "warning",
] as const;

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
            Every focusable control in one place. Tab through with the keyboard
            to validate the CSS-outline focus ring (it should hug the rounded
            corners and never clip against a container edge).
          </p>
        </header>

        <Section description="Single-line text field." title="Input">
          <div className="flex flex-col gap-3">
            <Input placeholder="Default input" />
            <Input aria-invalid placeholder="Invalid input" />
            <Input disabled placeholder="Disabled input" />
          </div>
        </Section>

        <Section
          description="Auto-growing multi-line field with a capped height."
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
          description="Composed field with addons and an inline button."
          title="Input group"
        >
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <MagnifyingGlassIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search..." />
            <InputGroupAddon align="inline-end">
              <InputGroupButton>Go</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Section>

        <Section description="Radix-backed dropdown." title="Select">
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
          <div className="flex flex-wrap gap-3">
            {buttonVariants.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </div>
        </Section>

        <Section
          description="Mostly static, but anchor badges are focusable."
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

        <Section title="Radio group">
          <RadioGroup defaultValue="one">
            <Label className="flex items-center gap-2">
              <RadioGroupItem value="one" />
              Option one
            </Label>
            <Label className="flex items-center gap-2">
              <RadioGroupItem value="two" />
              Option two
            </Label>
            <Label className="flex items-center gap-2">
              <RadioGroupItem value="three" />
              Option three
            </Label>
          </RadioGroup>
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
          description="Triggers should show the focus ring when tabbed to."
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

        <Section
          description="Thumb uses a soft box-shadow halo by design (not the outline ring)."
          title="Slider"
        >
          <Slider className="max-w-sm" defaultValue={[50]} max={100} step={1} />
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
