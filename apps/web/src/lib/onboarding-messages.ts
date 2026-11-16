import type { Locale } from "@chemdft/i18n";

const messages = {
  title: "Where would you like to begin?",
  introduction:
    "Bring a structure, a calculation file or experimental data. Choose a starting path; your project's Navigator will guide the next steps.",
  projectRule:
    "Choosing a path creates nothing. You'll confirm a project before opening an import or editor.",
  projects: "Projects",
  skip: "Go to projects",
  learn: "Learn",
  account: "Account",
  "molecule.title": "Start with a molecule",
  "molecule.description":
    "Draw a molecule or import molecular or crystal coordinates.",
  "molecule.next": "Choose an editor or structure import",
  "calculation.title": "Import a calculation",
  "calculation.description":
    "Bring a supported Gaussian or ORCA output and review its imported results.",
  "calculation.next": "Open preview and confirmation",
  "experimental.title": "Analyze experimental data",
  "experimental.description":
    "Import an IR, Raman or UV/Vis spectrum, confirm units and inspect the measurement.",
  "experimental.next": "Open spectrum import",
  "compare.title": "Compare experiment and calculation",
  "compare.description":
    "Review which calculated and measured records are still needed for comparison.",
  "compare.next": "Open the project's comparison goal",
  "examples.title": "Explore an example project",
  "examples.description":
    "Inspect real Cr₂O₃, benzene or caffeine reference structures. Copy only when you choose.",
  "examples.next": "Open the read-only catalogue · no project created",
  "unsure.title": "I'm not sure — guide me",
  "unsure.description":
    "Answer two short questions to choose a goal. No method recommendations or AI required.",
  "unsure.next": "Choose a goal · no project created",
  next: "What opens next",
  back: "Change starting path",
  startNew: "Start something new",
  projectDestination: "Which project?",
  newProject: "Create a new project",
  existingProject: "Use an existing project",
  name: "Project name",
  nameHint: "For example, Catalyst screening",
  chooseProject: "Select a project",
  commit: "Create project and continue",
  openExisting: "Continue in this project",
  busy: "Opening workflow…",
  commitNote:
    "This confirmation creates a normal project in your current organization. It does not create scientific data or run a calculation.",
  existingNote:
    "The server will check this project's current prerequisites and your role before opening a workflow.",
  loading: "Reading your projects…",
  loadError:
    "Your projects could not be loaded. Retry before choosing a destination.",
  retry: "Retry",
  nameRequired: "Enter a project name before creating the project.",
  createError:
    "The project could not be created. Check the connection and try again.",
  projectCreated:
    "The project was created, but its guidance could not be loaded. Open its Navigator to continue; no second project will be created.",
  openNavigator: "Open Project Navigator",
  unavailable:
    "This action is unavailable in the selected project. Its Navigator shows the current blockers.",
  entry: "Starting workflow",
  draw: "Draw a molecule",
  importMolecule: "Import molecular coordinates",
  importCrystal: "Import crystal coordinates (CIF)",
  crystalNote:
    "Crystal import supports structure, unit-cell and supercell inspection, and single-point periodic PBE or PBE+U energies (PySCF: Gamma only on the hosted beta; Quantum ESPRESSO: bigger meshes; up to 20 atoms). Relaxation, band structures and DOS are not available.",
  comparisonNote:
    "Comparison needs a matching calculated spectrum, a confirmed associated experimental spectrum and its peak set. Navigator checks the actual records.",
  questionOne: "What do you have?",
  questionTwo: "What would you like to do?",
  nothing: "Nothing yet",
  molecule: "A molecule or molecular structure",
  crystal: "A crystal structure",
  spectrum: "An experimental spectrum",
  calculationFile: "A calculation output file",
  recommend: "Choose this goal",
  changeAnswers: "Change answers",
  recommendation: "Your starting options",
  advisory:
    "These answers choose a product goal. They do not verify your files or select a scientific method. Navigator evaluates the actual project after you continue.",
  inspectSpectrum: "Inspect and process the measurement",
  importResults: "Review imported results",
  inspectCrystal: "Inspect the crystal and unit cell",
  missingStructure:
    "You'll first need saved structure coordinates. Import or draw them, then review charge and multiplicity.",
  molecularPrerequisites:
    "Calculation setup and Navigator check the saved geometry, charge, multiplicity and worker capabilities. Frequency and orbital workflows require a converged optimized geometry.",
  spectrumPrerequisites:
    "Choose the measurement's actual technique and units in the import preview. A comparison also needs matching calculated data and an explicit structure association.",
  importPrerequisites:
    "A supported output file must pass the existing preview/confirmation workflow. Imported results retain their source provenance.",
  ambiguous:
    "Either input is a valid place to begin. Choose the one you have ready; neither is claimed to be scientifically preferable.",
  emptyTitle: "No projects yet",
  emptyDescription:
    "Choose a starting path or explicitly create an empty normal project. Nothing runs automatically.",
  createEmpty: "Create empty project",
  emptyName: "Project name",
  examplesLink: "Explore reference examples",
} as const;

export type OnboardingMessageKey = keyof typeof messages;
export function onboardingMessage(
  _locale: Locale,
  key: OnboardingMessageKey,
): string {
  return messages[key]; // Existing English fallback; no unreviewed translations.
}
