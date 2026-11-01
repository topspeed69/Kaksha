import type {
  Course,
  Scene,
  Segment,
  SlideScene,
  WhiteboardScene,
  QuizScene,
} from "@/lib/dsl/types";
import { estimateSegmentMs } from "@/lib/dsl/validate";

/**
 * The reference fixture course, hand authored.
 *
 * Physics note: every relation below is standard (von Neumann entropy, the
 * partial trace, the Joos–Zeh scattering estimate). Where a number would have
 * to be invented, the fixture says "illustrative" instead.
 */

function seg(text: string, actions: Segment["actions"] = []): Segment {
  return {
    id: "",
    text,
    estimated_duration_ms: estimateSegmentMs(text),
    actions,
  };
}

const scene1: SlideScene = {
  kind: "slide",
  id: "sc1",
  index: 0,
  title: "What decoherence is",
  layout: "title",
  elements: [
    { id: "el1", type: "heading", text: "What decoherence is" },
    {
      id: "el2",
      type: "paragraph",
      text: "How a quantum system loses its ability to interfere, and why that looks classical from the inside.",
    },
    {
      id: "el3",
      type: "callout",
      text: "Two hours of study time is enough for this module. Nothing here needs quantum field theory.",
    },
  ],
  segments: [
    seg(
      "Welcome. This module is about decoherence: the process by which a quantum system stops behaving like a quantum system, at least as far as measurements on it are concerned.",
      [{ op: "reveal", at: 0, target: "el1" }],
    ),
    seg(
      "The word is easy to misread. Decoherence is not the same as dissipation, and it is not the collapse postulate either. It is something that happens in between, and it happens without any observer.",
      [
        { op: "reveal", at: 0.1, target: "el2" },
        { op: "spotlight", at: 0.45, target: "el2" },
      ],
    ),
    seg(
      "By the end you should be able to say what a coherence is, in the language of density matrices, and why an environment destroys the ones we cannot see.",
      [
        { op: "clear_focus", at: 0.05 },
        { op: "reveal", at: 0.2, target: "el3" },
        { op: "spotlight", at: 0.6, target: "el3" },
      ],
    ),
    seg(
      "One warning before we start. Nothing in this module says which interpretation of quantum mechanics is right. Decoherence is an agreed piece of physics. What it means for the measurement problem is still argued about, and we will flag that when we get there.",
      [{ op: "clear_focus", at: 0.5 }],
    ),
  ],
  sources: [],
};

const scene2: SlideScene = {
  kind: "slide",
  id: "sc2",
  index: 1,
  title: "Pure states, mixed states and the density operator",
  layout: "equation_focus",
  elements: [
    { id: "el1", type: "heading", text: "Pure, mixed, and the density operator" },
    {
      id: "el2",
      type: "equation",
      latex: "\\rho = \\sum_i p_i\\,|\\psi_i\\rangle\\langle\\psi_i|,\\qquad \\operatorname{tr}\\rho = 1,\\ \\rho^2 \\preceq \\rho",
      display: true,
      caption: "A density operator is a probability mixture of pure states.",
    },
    {
      id: "el3",
      type: "bullets",
      items: [
        "Pure: one state vector, full coherence",
        "Mixed: a statistical mixture, no phase",
        "The trace is preserved; information is not",
      ],
    },
  ],
  segments: [
    seg(
      "First the language. A pure state is a single state vector. A mixed state is a classical probability distribution over several of them. The density operator carries both cases in one object.",
      [{ op: "reveal", at: 0, target: "el1" }],
    ),
    seg(
      "Read the equation as a recipe. Take some states, take some probabilities that add up to one, and add up the outer products. The trace of the result is always one.",
      [
        { op: "reveal", at: 0.05, target: "el2" },
        { op: "spotlight", at: 0.4, target: "el2" },
      ],
    ),
    seg(
      "The test for purity is simple: square the operator. For a pure state the square is the operator again, and the trace of the square is one. For anything mixed, that trace drops below one.",
      [
        { op: "clear_focus", at: 0.05 },
        { op: "reveal", at: 0.15, target: "el3" },
        { op: "spotlight", at: 0.55, target: "el3" },
      ],
    ),
    seg(
      "Notice what this object buys us. A single state vector cannot describe a system that is entangled with something else, because on its own it is not in any state at all. The density operator still works, and that is why we use it for everything that follows.",
      [{ op: "clear_focus", at: 0.4 }],
    ),
  ],
  sources: [],
};

const scene3: WhiteboardScene = {
  kind: "whiteboard",
  id: "sc3",
  index: 2,
  title: "Tracing out the environment",
  canvas: { w: 1280, h: 720 },
  steps: [
    {
      id: "step1",
      title: "Write the joint state",
      summary_latex: "|\\Psi\\rangle = |\\psi\\rangle_S \\otimes |E_0\\rangle",
      segment_ids: ["s1", "s2"],
      assumptions: [
        "The joint system S plus E is closed, so its evolution is unitary.",
        "The environment starts in a pure state; nothing is assumed about its size beyond 'many degrees of freedom'.",
      ],
      variables: [
        { symbol: "S", meaning: "the system we can measure" },
        { symbol: "E", meaning: "everything we cannot keep track of" },
      ],
    },
    {
      id: "step2",
      title: "Take the partial trace",
      summary_latex: "\\rho_S = \\operatorname{tr}_E |\\Psi\\rangle\\langle\\Psi|",
      segment_ids: ["s3", "s4"],
      assumptions: ["Tracing out E is a statement about our access, not about the physics."],
      variables: [{ symbol: "tr_E", meaning: "sum over the environment basis" }],
    },
    {
      id: "step3",
      title: "Read the off-diagonal terms",
      summary_latex: "\\rho_{mn}(t) = c_m c_n^*\\,\\langle E_n(t)|E_m(t)\\rangle",
      segment_ids: ["s5", "s6"],
      assumptions: [
        "The overlap of environment states is a real number between zero and one.",
      ],
      variables: [
        { symbol: "⟨E_n|E_m⟩", meaning: "how distinguishable the environment finds two system states" },
      ],
    },
  ],
  segments: [
    {
      ...seg(
        "We now do the only computation in this module on the board. Start with a system, and an environment, and assume the pair is closed. Closed means unitary, and unitary means we can track everything in principle.",
      ),
      id: "s1",
      actions: [
        { op: "wb.text", at: 0.05, id: "t1", x: 70, y: 70, text: "1. Joint state", size: "lg" },
        { op: "wb.rect", at: 0.2, id: "r1", x: 70, y: 130, w: 300, h: 90, label: "System S" },
        { op: "wb.rect", at: 0.35, id: "r2", x: 430, y: 130, w: 300, h: 90, dashed: true, label: "Environment E" },
      ],
    },
    {
      ...seg(
        "Write the total state as a product, at least at the start. The system part is what we will keep. The environment part is what we will throw away.",
      ),
      id: "s2",
      actions: [
        { op: "wb.latex", at: 0.15, id: "m1", x: 800, y: 150, latex: "|\\Psi\\rangle = |\\psi\\rangle_S \\otimes |E_0\\rangle", size: "sm" },
        { op: "wb.highlight", at: 0.5, target: "m1" },
        { op: "wb.line", at: 0.8, id: "l1", from: [370, 175], to: [430, 175], arrow: true },
      ],
    },
    {
      ...seg(
        "Now the operation that does all the work: the partial trace. We sum over the environment's basis states, keeping only the indices that belong to the system. This is bookkeeping about our access, not a physical disturbance.",
      ),
      id: "s3",
      actions: [
        { op: "wb.erase", at: 0.05, target: "r2" },
        { op: "wb.text", at: 0.15, id: "t2", x: 70, y: 290, text: "2. Partial trace", size: "lg" },
        { op: "wb.latex", at: 0.35, id: "m2", x: 430, y: 300, latex: "\\rho_S = \\operatorname{tr}_E\\,|\\Psi\\rangle\\langle\\Psi|", size: "md" },
        { op: "wb.highlight", at: 0.7, target: "m2" },
      ],
    },
    {
      ...seg(
        "In components, this is a sum over environment labels. Each term keeps a factor that is the overlap of two environment states. Hold on to that factor; it is about to become the whole story.",
      ),
      id: "s4",
      actions: [
        { op: "wb.latex", at: 0.25, id: "m3", x: 430, y: 380, latex: "\\langle E_n|E_m\\rangle", size: "sm" },
        { op: "wb.highlight", at: 0.6, target: "m3" },
      ],
    },
    {
      ...seg(
        "Put the system in a superposition of two states, and let it entangle with the environment. Each branch drags the environment into a slightly different state, and those two environment states need not overlap.",
      ),
      id: "s5",
      actions: [
        { op: "wb.erase", at: 0.05, target: "m1" },
        { op: "wb.text", at: 0.12, id: "t3", x: 70, y: 500, text: "3. Off-diagonals", size: "lg" },
        { op: "wb.latex", at: 0.35, id: "m4", x: 430, y: 510, latex: "\\rho_{mn}(t) = c_m c_n^*\\,\\langle E_n(t)|E_m(t)\\rangle", size: "md" },
        { op: "wb.highlight", at: 0.7, target: "m4" },
      ],
    },
    {
      ...seg(
        "When that overlap goes to zero, the off-diagonal terms vanish. No energy has to change hands. The system has not relaxed; it has simply lost the phase relation that made it quantum.",
      ),
      id: "s6",
      actions: [
        { op: "wb.axes", at: 0.1, id: "ax1", x: 900, y: 470, w: 320, h: 190, x_label: "time", y_label: "overlap" },
        { op: "wb.plot", at: 0.35, id: "p1", axes: "ax1", expr: "exp(-0.6 * x)", domain: [0, 5], color: "accent" },
        { op: "wb.text", at: 0.7, id: "t4", x: 900, y: 440, text: "Illustrative decay", size: "sm" },
        { op: "wb.highlight", at: 0.85, target: "p1" },
      ],
    },
    {
      ...seg(
        "That is the mechanism in one picture. In the next scene we turn it into a number, and in the module after that we ask why the environment picks out the particular states it does.",
      ),
      id: "s7",
      actions: [{ op: "wb.highlight", at: 0.3, target: "t3" }],
    },
  ],
  sources: [],
};

const scene4: SlideScene = {
  kind: "slide",
  id: "sc4",
  index: 3,
  title: "Coherence is off-diagonal weight",
  layout: "text_figure",
  elements: [
    { id: "el1", type: "heading", text: "Coherence is off-diagonal weight" },
    {
      id: "el2",
      type: "figure",
      spec: {
        kind: "plot",
        x_label: "time",
        y_label: "coherence",
        domain: [0, 5],
        series: [
          { label: "Coherence |⟨E_n|E_m⟩|", expr: "exp(-0.9 * x)", color: "accent" },
          { label: "Population (unchanged)", expr: "1", color: "ink" },
        ],
        annotations: [{ x: 3, text: "coherence gone, population kept" }],
      },
      caption: "Illustrative curves: the shape is the point, not the numbers.",
    },
    {
      id: "el3",
      type: "callout",
      text: "Decoherence removes phase information and keeps populations.",
    },
  ],
  segments: [
    seg(
      "Here is the same statement as a picture. The lower curve is the coherence, the size of the off-diagonal term. The flat line is a population, the size of a diagonal term.",
      [{ op: "reveal", at: 0, target: "el1" }],
    ),
    seg(
      "Watch what the environment does. The coherence falls away, and the population does not move at all. Both statements are idealisations, but the split between them is real, and it is the reason decoherence is not the same thing as relaxation.",
      [
        { op: "reveal", at: 0.05, target: "el2" },
        { op: "spotlight", at: 0.4, target: "el2" },
      ],
    ),
    seg(
      "The axes are labelled illustrative on purpose. The rate depends on the system and on what is around it, and we will get the standard estimate for it in the second module.",
      [
        { op: "clear_focus", at: 0.05 },
        { op: "reveal", at: 0.2, target: "el3" },
      ],
    ),
    seg(
      "Keep the two axes in mind as a pair. Whenever you read a claim about decoherence in a paper, the first question to ask is which of the two curves the author is talking about. Mixing them up is the most common error in this part of the literature.",
      [{ op: "spotlight", at: 0.4, target: "el2" }],
    ),
  ],
  sources: [],
};

const scene5: SlideScene = {
  kind: "slide",
  id: "sc5",
  index: 4,
  title: "A system coupled to many oscillators",
  layout: "text_figure",
  elements: [
    { id: "el1", type: "heading", text: "A system coupled to many oscillators" },
    {
      id: "el2",
      type: "figure",
      spec: {
        kind: "diagram",
        nodes: [
          { id: "n1", label: "System S", x: 8, y: 40, w: 22, h: 16 },
          { id: "n2", label: "Interaction", x: 42, y: 40, w: 24, h: 16, dashed: true },
          { id: "n3", label: "Bath of oscillators", x: 74, y: 40, w: 24, h: 16 },
          { id: "n4", label: "Reduced state", x: 42, y: 76, w: 24, h: 14, dashed: true },
        ],
        edges: [
          { from: "n1", to: "n2", label: "H_S" },
          { from: "n2", to: "n3", label: "V" },
          { from: "n3", to: "n4", label: "trace", dashed: true },
        ],
      },
      caption: "The Caldeira–Leggett picture: one system, very many modes.",
    },
    {
      id: "el3",
      type: "bullets",
      items: ["Bath modes never become classical", "Only the trace is observable"],
    },
  ],
  segments: [
    seg(
      "Second module. To say anything quantitative we need a model of the environment. The standard one is a bath of harmonic oscillators, each weakly coupled to the system.",
      [{ op: "reveal", at: 0, target: "el1" }],
    ),
    seg(
      "Read the diagram left to right. The system has its own Hamiltonian. The interaction term is what entangles the two sides. And everything we can measure sits below, after the trace over the bath.",
      [
        { op: "reveal", at: 0.05, target: "el2" },
        { op: "spotlight", at: 0.45, target: "el2" },
      ],
    ),
    seg(
      "Two warnings. The bath modes are not classical noise. And the trace is not a measurement. Both mistakes lead to the wrong intuition about when decoherence is reversible.",
      [
        { op: "clear_focus", at: 0.05 },
        { op: "reveal", at: 0.15, target: "el3" },
      ],
    ),
    seg(
      "A note on scope. The oscillator bath is a model, and a good one, but it is not the only environment that matters. A superconducting qubit sees a microwave cavity. A dust grain sees air molecules and photons. The mathematics we are about to do covers all of them, with different couplings plugged in.",
      [{ op: "clear_focus", at: 0.5 }],
    ),
  ],
  sources: [],
};

const scene6: WhiteboardScene = {
  kind: "whiteboard",
  id: "sc6",
  index: 5,
  title: "The decoherence factor, step by step",
  canvas: { w: 1280, h: 720 },
  steps: [
    {
      id: "step1",
      title: "Assume a product state and unitary coupling",
      summary_latex: "U(t) = \\exp\\!\\big(-i (H_S + H_E + V) t/\\hbar\\big)",
      segment_ids: ["s1", "s2"],
      assumptions: [
        "Weak coupling, so the interaction picture is meaningful.",
        "The environment is large enough that recurrences are irrelevant on our timescale.",
      ],
      variables: [
        { symbol: "V", meaning: "the system–environment interaction" },
        { symbol: "ħ", meaning: "Planck's constant over two pi" },
      ],
    },
    {
      id: "step2",
      title: "Follow one pair of branches",
      summary_latex: "r(t) = \\prod_k \\cos(g_k t)",
      segment_ids: ["s3", "s4"],
      assumptions: ["Each bath mode contributes independently (a product, not a sum)."],
      variables: [{ symbol: "g_k", meaning: "coupling strength of bath mode k" }],
    },
    {
      id: "step3",
      title: "Turn the product into a decay rate",
      summary_latex: "|r(t)| \\simeq \\exp(-\\Lambda t),\\quad \\Lambda > 0",
      segment_ids: ["s5", "s6"],
      assumptions: [
        "Many weakly coupled modes, so the product becomes an exponential.",
      ],
      variables: [{ symbol: "Λ", meaning: "the decoherence rate set by the bath" }],
    },
  ],
  segments: [
    {
      ...seg(
        "Let us build the decoherence factor ourselves. Assumptions first, because they are load bearing: weak coupling, a large bath, and unitary evolution of the joint system. Everything else follows.",
      ),
      id: "s1",
      actions: [
        { op: "wb.text", at: 0.05, id: "u1", x: 60, y: 60, text: "1. Assumptions", size: "lg" },
        { op: "wb.rect", at: 0.2, id: "ub1", x: 60, y: 120, w: 420, h: 100, label: "Weak coupling" },
        { op: "wb.rect", at: 0.35, id: "ub2", x: 60, y: 240, w: 420, h: 100, label: "Large bath", dashed: true },
      ],
    },
    {
      ...seg(
        "Write the total Hamiltonian as three pieces: the system, the bath, and the interaction that mixes them. The evolution operator for the whole thing is unitary, always.",
      ),
      id: "s2",
      actions: [
        { op: "wb.latex", at: 0.15, id: "um1", x: 560, y: 150, latex: "H = H_S + H_E + V", size: "md" },
        { op: "wb.latex", at: 0.45, id: "um2", x: 560, y: 230, latex: "U(t)=\\exp\\!\\left[-i(H_S+H_E+V)t/\\hbar\\right]", size: "sm" },
        { op: "wb.highlight", at: 0.75, target: "um1" },
      ],
    },
    {
      ...seg(
        "Now take two branches of a superposition and follow them. Each branch pushes the bath along a slightly different path. If the bath is a set of modes, each mode picks up its own phase.",
      ),
      id: "s3",
      actions: [
        { op: "wb.erase", at: 0.05, target: "ub2" },
        { op: "wb.text", at: 0.12, id: "u2", x: 60, y: 400, text: "2. One pair of branches", size: "lg" },
        { op: "wb.circle", at: 0.3, id: "uc1", cx: 300, cy: 470, r: 55, label: "branch m" },
        { op: "wb.circle", at: 0.5, id: "uc2", cx: 470, cy: 470, r: 55, label: "branch n" },
      ],
    },
    {
      ...seg(
        "For a single mode the factor is a cosine. For the whole bath it is the product of all of them, one factor per mode. That product is the decoherence factor.",
      ),
      id: "s4",
      actions: [
        { op: "wb.latex", at: 0.2, id: "um3", x: 620, y: 430, latex: "r(t) = \\prod_k \\cos(g_k t)", size: "md" },
        { op: "wb.highlight", at: 0.6, target: "um3" },
        { op: "wb.line", at: 0.85, id: "ul1", from: [620, 520], to: [1150, 520] },
      ],
    },
    {
      ...seg(
        "Individually each cosine is harmless. The problem is that there are very many of them, with different frequencies, so their product collapses much faster than any single factor would suggest.",
      ),
      id: "s5",
      actions: [
        { op: "wb.axes", at: 0.1, id: "uax", x: 700, y: 200, w: 480, h: 200, x_label: "t", y_label: "r(t)" },
        { op: "wb.plot", at: 0.3, id: "up1", axes: "uax", expr: "exp(-1.4 * x)", domain: [0, 4], color: "accent" },
        { op: "wb.plot", at: 0.55, id: "up2", axes: "uax", expr: "cos(6 * x)", domain: [0, 4] },
        { op: "wb.text", at: 0.75, id: "u3", x: 760, y: 120, text: "Product: fast decay", size: "sm" },
      ],
    },
    {
      ...seg(
        "With many modes the product is well approximated by an exponential in time. The rate is set by the bath, not by the system, and it is this rate that we will now compare with ordinary relaxation.",
      ),
      id: "s6",
      actions: [
        { op: "wb.text", at: 0.1, id: "u4", x: 60, y: 580, text: "3. Decay rate", size: "lg" },
        { op: "wb.latex", at: 0.35, id: "um4", x: 380, y: 590, latex: "|r(t)| \\simeq e^{-\\Lambda t}", size: "md" },
        { op: "wb.highlight", at: 0.7, target: "um4" },
      ],
    },
    {
      ...seg(
        "This is where the assumptions earn their keep. Drop the assumption of many modes and the product does not become a clean exponential. Drop weak coupling and the interaction picture is no longer trustworthy. Everything downstream inherits these conditions.",
      ),
      id: "s7",
      actions: [
        { op: "wb.erase", at: 0.1, target: "ub1" },
        { op: "wb.highlight", at: 0.4, target: "u4" },
      ],
    },
  ],
  sources: [],
};

const scene7: SlideScene = {
  kind: "slide",
  id: "sc7",
  index: 6,
  title: "Pointer states and einselection",
  layout: "two_column",
  elements: [
    { id: "el1", type: "heading", text: "Pointer states and einselection" },
    {
      id: "el2",
      type: "bullets",
      items: [
        "Stable states survive monitoring",
        "Unstable states entangle and die",
        "The basis is chosen by the coupling",
      ],
    },
    {
      id: "el3",
      type: "equation",
      latex: "[V, \\hat{A}] \\approx 0 \\;\\Rightarrow\\; \\{|a\\rangle\\}\\ \\text{are pointer states}",
      display: true,
      caption: "Pointer states approximately commute with the interaction.",
    },
  ],
  segments: [
    seg(
      "Decoherence does not treat all states equally. Some states get entangled with the environment very quickly, and some hardly at all. The survivors are called pointer states.",
      [{ op: "reveal", at: 0, target: "el1" }],
    ),
    seg(
      "The rule of thumb is on the board. If a state approximately commutes with the interaction operator, the environment cannot tell the difference between it and a neighbour, so it leaves the phase alone.",
      [
        { op: "reveal", at: 0.1, target: "el3" },
        { op: "spotlight", at: 0.45, target: "el3" },
      ],
    ),
    seg(
      "This selection is called einselection, for environment induced superselection. It explains why measurements give us stable, repeatable values in one particular basis and not in any other.",
      [
        { op: "clear_focus", at: 0.05 },
        { op: "reveal", at: 0.15, target: "el2" },
        { op: "spotlight", at: 0.6, target: "el2" },
      ],
    ),
    seg(
      "One consequence worth pausing on. Because the environment selects the basis, the classical properties we end up seeing are not chosen by us. Position is not special because we like it. It is special because scattering interactions care about position.",
      [{ op: "clear_focus", at: 0.5 }],
    ),
  ],
  sources: [],
};

const scene8: SlideScene = {
  kind: "slide",
  id: "sc8",
  index: 7,
  title: "How fast, compared with relaxation",
  layout: "equation_focus",
  elements: [
    { id: "el1", type: "heading", text: "How fast, compared with relaxation" },
    {
      id: "el2",
      type: "equation",
      latex: "\\tau_D \\;\\sim\\; \\tau_R\\left(\\frac{\\lambda_{dB}}{\\Delta x}\\right)^{2}",
      display: true,
      caption: "Joos–Zeh estimate for scattering-induced decoherence of a superposition separated by Δx.",
    },
    {
      id: "el3",
      type: "bullets",
      items: [
        "λ_dB: thermal de Broglie wavelength",
        "Δx: separation of the two branches",
        "Macroscopic Δx makes τ_D tiny",
      ],
    },
  ],
  segments: [
    seg(
      "The standard estimate for a superposition of two positions separated by some distance compares decoherence with ordinary thermal relaxation.",
      [{ op: "reveal", at: 0, target: "el1" }],
    ),
    seg(
      "The ratio of the thermal wavelength to the separation enters squared. That square is the whole point. Make the separation a thousand times the wavelength and the decoherence time becomes a millionth of the relaxation time.",
      [
        { op: "reveal", at: 0.05, target: "el2" },
        { op: "spotlight", at: 0.4, target: "el2" },
      ],
    ),
    seg(
      "So for anything big enough to see, the loss of coherence is effectively instantaneous while the energy relaxation is still slow. That asymmetry is what makes the classical world look classical.",
      [
        { op: "clear_focus", at: 0.05 },
        { op: "reveal", at: 0.15, target: "el3" },
      ],
    ),
    seg(
      "Be careful with the formula's range. It is an estimate for scattering induced decoherence in a thermal environment, and it says nothing about isolated ions in a trap, or about a superposition kept in a cavity. The estimate is a guide to orders of magnitude, not a law.",
      [{ op: "spotlight", at: 0.45, target: "el2" }],
    ),
  ],
  sources: [],
};

const scene9: QuizScene = {
  kind: "quiz",
  id: "sc9",
  index: 8,
  title: "Check yourself: decoherence",
  pass_mark: 0.6,
  questions: [
    {
      id: "q1",
      objective_id: "obj1",
      type: "single",
      prompt:
        "A system's density matrix loses its off-diagonal terms but its diagonal terms are unchanged. What happened?",
      context: "Module 1, scene 4: coherence is off-diagonal weight.",
      choices: [
        {
          id: "c1",
          text: "It decohered: phase information was lost, populations were kept",
          detail: "The overlap of environment states went to zero.",
        },
        {
          id: "c2",
          text: "It relaxed: energy was dissipated into the environment",
          detail: "Relaxation moves the diagonal terms.",
        },
        {
          id: "c3",
          text: "Its state vector collapsed by the measurement postulate",
          detail: "No measurement postulate is needed for decoherence.",
        },
        {
          id: "c4",
          text: "It was never a valid density matrix",
          detail: "A matrix with non-zero diagonals and unit trace is valid.",
        },
      ],
      correct: ["c1"],
      explanation:
        "Decoherence suppresses off-diagonal (coherence) terms while leaving populations alone. Relaxation is the complementary process, which changes the diagonal. The measurement postulate is not involved: an unobserved environment is enough.",
      sources: [],
    },
    {
      id: "q2",
      objective_id: "obj2",
      type: "multi",
      prompt: "Which of these are assumptions used in deriving the exponential decoherence factor?",
      context: "Module 2, whiteboard scene: the decoherence factor.",
      choices: [
        { id: "c1", text: "Weak coupling between system and bath" },
        { id: "c2", text: "A bath with very many modes" },
        { id: "c3", text: "That the bath is classical thermal noise" },
        { id: "c4", text: "That recurrences are irrelevant on the timescale of interest" },
      ],
      correct: ["c1", "c2", "c4"],
      explanation:
        "The bath stays quantum throughout; treating it as classical noise is a common mistake and is exactly what the derivation does not assume. Weak coupling, many modes and no recurrences are the three assumptions used.",
      sources: [],
    },
    {
      id: "q3",
      objective_id: "obj2",
      type: "short",
      prompt:
        "In two or three sentences, explain why the partial trace is a statement about our access rather than a physical disturbance.",
      context: "Module 1, whiteboard scene: tracing out the environment.",
      explanation:
        "The joint state still evolves unitarily; the trace only discards the labels we cannot keep track of.",
      rubric: {
        criteria: [
          {
            id: "c1",
            label: "Unitary evolution of the joint system",
            weight: 0.4,
            description: "Says that the combined system plus environment still evolves unitarily.",
          },
          {
            id: "c2",
            label: "Trace as discarding information",
            weight: 0.4,
            description: "Says that tracing removes degrees of freedom we do not track.",
          },
          {
            id: "c3",
            label: "No disturbance needed",
            weight: 0.2,
            description: "Notes that no measurement or physical kick is required.",
          },
        ],
        key_points: [
          "The joint state of system and environment evolves unitarily.",
          "The partial trace sums over environment labels we cannot observe.",
          "Nothing has to interact with the system for the trace to be taken.",
        ],
        reference_answer:
          "The combined system and environment is closed, so its state keeps evolving unitarily. Taking the partial trace just sums over the environment labels we have no access to; it is bookkeeping on our side. No interaction, measurement or disturbance is required for that step.",
      },
      sources: [],
    },
    {
      id: "q4",
      objective_id: "obj3",
      type: "derivation",
      prompt:
        "Starting from a superposition of two positions separated by Δx, derive the ratio of the decoherence time to the relaxation time, and state where each assumption is used.",
      context: "Module 2, scene 8: the Joos–Zeh estimate.",
      explanation:
        "The squared ratio of the thermal de Broglie wavelength to the separation comes from the scattering rate growing with the separation squared.",
      rubric: {
        criteria: [
          {
            id: "c1",
            label: "Sets up the superposition",
            weight: 0.25,
            description: "Writes the state as a superposition of two position states separated by Δx.",
          },
          {
            id: "c2",
            label: "Finds the suppression of the off-diagonal term",
            weight: 0.35,
            description:
              "Shows that scattering suppresses the off-diagonal term by a factor depending on the squared separation.",
          },
          {
            id: "c3",
            label: "Compares with relaxation",
            weight: 0.25,
            description: "Relates the decoherence rate to the thermal relaxation rate and the wavelength.",
          },
          {
            id: "c4",
            label: "States the assumptions",
            weight: 0.15,
            description: "Names at least one assumption (scattering regime, thermal bath) and where it is used.",
          },
        ],
        key_points: [
          "The state is a superposition of two positions separated by Δx.",
          "The off-diagonal term decays as exp of minus Λ t, with Λ proportional to Δx squared.",
          "The relaxation rate sets the overall scale, giving the squared ratio of λ_dB to Δx.",
          "The estimate assumes scattering-induced decoherence in a thermal bath.",
        ],
        reference_answer:
          "Write the state as a superposition of two positions separated by Δx. Scattering of environment particles off the system suppresses the off-diagonal term as exp of minus Λ t, where Λ is proportional to Δx squared and to the scattering rate, which is set by the thermal relaxation time τ_R and the thermal de Broglie wavelength λ_dB. Identifying the scale gives τ_D ≈ τ_R (λ_dB/Δx)². The assumptions are that decoherence is scattering-induced and that the bath is thermal; both enter through Λ.",
      },
      sources: [],
    },
  ],
  segments: [
    seg(
      "Time to check what stuck. Four questions: two about the ideas, one short answer, and one derivation. Take your time, and use the draft feedback before you submit.",
    ),
  ],
  sources: [],
};

const scenes: Scene[] = [
  scene1,
  scene2,
  scene3,
  scene4,
  scene5,
  scene6,
  scene7,
  scene8,
  scene9,
];

function numberSegments(course: Course): Course {
  const next: Course = JSON.parse(JSON.stringify(course));
  for (const moduleBlock of next.modules) {
    for (const scene of moduleBlock.scenes) {
      scene.segments.forEach((segment, index) => {
        segment.id = `s${index + 1}`;
      });
    }
  }
  return next;
}

export function buildFixtureCourse(options?: {
  id?: string;
  voice?: { id: string; speed: number };
}): Course {
  const modules = [
    {
      id: "mod1",
      index: 0,
      title: "Density matrices and open systems",
      objectives: [
        {
          id: "obj1",
          text: "Explain what a coherence is in the language of density matrices",
          bloom: "understand" as const,
        },
        {
          id: "obj2",
          text: "Carry out a partial trace over an environment",
          bloom: "apply" as const,
        },
      ],
      duration_min: 5,
      prerequisites: [],
      scenes: scenes.slice(0, 4),
    },
    {
      id: "mod2",
      index: 1,
      title: "Coupling to an environment and its consequences",
      objectives: [
        {
          id: "obj2",
          text: "Derive the decoherence factor for a bath of oscillators",
          bloom: "analyze" as const,
        },
        {
          id: "obj3",
          text: "Estimate a decoherence time and compare it with relaxation",
          bloom: "evaluate" as const,
        },
      ],
      duration_min: 5,
      prerequisites: ["Module 1: density matrices", "the partial trace"],
      scenes: scenes.slice(4),
    },
  ];
  return numberSegments({
    version: 1,
    id: options?.id ?? "fixture-quantum-decoherence",
    title: "Quantum decoherence and the classical world",
    source: {
      kind: "topic",
      label: "your topic (no reference material)",
      material_ids: [],
    },
    depth: "undergraduate",
    background: "familiar",
    minutes_target: 10,
    language: "en",
    voice: options?.voice ?? { id: "captions", speed: 1 },
    status: "ready",
    generator: {
      label: "Hand authored reference fixture",
      modelled: false,
    },
    modules,
  });
}

export const fixtureScenes = scenes;
