import { dedent } from "radashi";

export const TUTORIAL_TASK_REPLAY = {
  project: {
    folderName: "how-to-use-instrument",
    templateName: "basic",
    title: "How to use Instrument",
  },
  steps: [
    {
      kind: "user",
      text: "I'm new to Instrument. Make a file that explains what Instrument can do and how to use it.",
    },
    {
      kind: "assistantText",
      text: "Sure! I'll create a tutorial file to teach you about Instrument.",
    },
    {
      content: dedent`
        # Getting started with Instrument

        Instrument is a powerful general-purpose AI assistant that runs locally on your computer. It acts as an automation layer, helping you accomplish tasks through natural conversation.

        ## What Instrument can do

        Instrument helps with almost any multi-step task involving code, documents, file conversion, and web research, including:

        - Research and information gathering
        - Writing documents, reports, and content
        - Data analysis and visualization
        - Building apps and scripts
        - Generating images and other media
        - Working with uploaded files and folders
        - Running shell commands, installing packages, and executing code
        - Browsing websites, filling forms, and scraping data
        - Creating PDFs, presentations, spreadsheets, and more

        Everything happens inside an isolated project folder on your computer, keeping your work organized and versioned.

        ## How Instrument is unique

        Instrument stands apart from typical AI chat tools in a few key ways:

        - **Local execution:** Instrument runs directly on your machine, giving it access to your files, terminal, and system resources within sandboxed project boundaries.
        - **True automation:** When you ask it to download a file, edit code, generate assets, or process data, it does the work using the same tools you would use yourself.
        - **File-centric workflow:** Generated outputs appear as previews in your chat. You can upload files or attach folders to bring external content into the workspace.
        - **Project isolation and versioning:** Each project lives in its own folder with automatic history. Old file versions are always recoverable.
        - **Skill-based extensibility:** Specialized capabilities, such as browser automation, document handling, and image processing, are available on demand without leaving the conversation.

        In short: other AIs tell you how to do things. Instrument does them for you.

        ## Example prompts to try

        Try one of these prompts to see what Instrument can do:

        1. **Create a professional resume in a Word document using the attached PDF as source material.**
           Attach a PDF. Instrument will extract the content and generate a polished .docx file.

        2. **Build an interactive dashboard in HTML that shows sales data from this CSV file. Include charts.**
           Attach a CSV. Instrument will parse it, generate visuals, and produce a working HTML file in the "Made by Instrument" folder.

        3. **Research the latest releases from leading independent type foundries. Summarize the top 10 releases, and create a nicely formatted PDF report with details and a link for each one.**
           Instrument will search the web, gather information, and output a professional PDF.

        4. **Generate a series of product icons in different styles using AI image generation, then combine them into a single comparison image.**
           This demonstrates image creation and manipulation.

        5. **Write a Python script that scrapes a website for prices, saves the results to a spreadsheet, and prepares an email draft with the file attached.**
           This shows code writing, execution, data export, and practical automation.
      `.trim(),
      explanation: "Creating an Instrument tutorial file for you.",
      filePath: "./output/instrument-tutorial.md",
      kind: "writeFile",
      toolCallId: "call_tutorialTaskWrite",
    },
    {
      kind: "assistantText",
      text: dedent`
        I've successfully created a tutorial file for you and attached it below. It covers what Instrument can do, how it differs from typical AI tools, and several example prompts for work and personal use.

        I can also tailor my advice to you. Answer these questions so I can help you find ways to use Instrument for your own projects.

        1. What kinds of tasks are you usually responsible for at work (e.g., coding, content creation, data analysis, personal organization)?
        2. Do you have any specific apps, programming languages, or file types you work with regularly?
        3. What parts of your daily work or personal productivity usually take the most time or feel repetitive?
      `.trim(),
    },
  ],
} as const;

export type TutorialTaskWriteFileStep = Extract<
  (typeof TUTORIAL_TASK_REPLAY.steps)[number],
  { kind: "writeFile" }
>;
