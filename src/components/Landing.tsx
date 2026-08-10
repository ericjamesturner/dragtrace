import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * Marketing page shown at the root to signed-out visitors.
 *
 * Written for a racer in his fifties who does not think of himself as a
 * computer person: plain words, short sentences, nothing that assumes he
 * already knows what a "workspace" or an "expression" is. Type is set larger
 * and lighter than the app's chrome because it will be read on a phone in the
 * sun, by eyes that are not twenty-five.
 *
 * The chart paths below are sampled from one real quarter-mile Haltech pass, so
 * the shape is the real thing: RPM brought up on the brake, the hit, the shelf
 * while it loads, the droop mid-track, then the pull to the stripe with the
 * driveshaft climbing off zero underneath it. The splits place the marks. No
 * elapsed time or trap speed is shown anywhere, and the channel readouts are
 * rounded stand-ins.
 */

/** Where the run starts and ends inside the plotted window. */
const LAUNCH_X = 20.1;
const FINISH_X = 91.4;

/** The pass's real splits, used to place the marks. No times are shown. */
const MARKS = [
  { mark: "60'", at: 1.055, color: "#ef4444" },
  { mark: "330'", at: 2.956, color: "#f59e0b" },
  { mark: "660'", at: 4.55, color: "#22c55e" },
  { mark: "1000'", at: 5.921, color: "#14b8a6" },
  { mark: "1320'", at: 7.082, color: "#3b82f6" },
] as const;
const FINISH = 7.082;
const markX = (at: number) => LAUNCH_X + (at / FINISH) * (FINISH_X - LAUNCH_X);

/** Sampled from real passes. See the note at the top of this file. */
const CURVES = {
  rpm: "M0.00,68.5L0.43,68.0L0.87,68.1L1.30,68.8L1.73,68.3L2.16,69.2L2.60,68.6L3.03,68.7L3.46,68.6L3.90,69.0L4.33,69.1L4.76,69.3L5.20,69.3L5.63,70.0L6.06,69.6L6.49,70.4L6.93,69.5L7.36,70.3L7.79,70.0L8.23,69.4L8.66,69.6L9.09,69.3L9.52,69.3L9.96,70.0L10.39,68.9L10.82,63.3L11.26,58.5L11.69,56.0L12.12,55.4L12.56,53.8L12.99,52.8L13.42,50.2L13.85,45.5L14.29,44.3L14.72,45.3L15.15,45.6L15.59,45.0L16.02,44.8L16.45,45.1L16.88,44.6L17.32,46.0L17.75,45.5L18.18,45.1L18.62,44.7L19.05,45.7L19.48,44.8L19.92,44.5L20.35,43.6L20.78,38.9L21.21,34.7L21.65,31.7L22.08,29.8L22.51,28.0L22.95,27.1L23.38,26.3L23.81,26.0L24.24,25.5L24.68,25.5L25.11,25.0L25.54,25.0L25.98,24.8L26.41,24.8L26.84,24.6L27.28,24.3L27.71,24.5L28.14,23.9L28.57,23.7L29.01,23.3L29.44,23.3L29.87,22.7L30.31,22.5L30.74,22.7L31.17,22.4L31.60,22.3L32.04,22.4L32.47,22.0L32.90,22.0L33.34,21.9L33.77,21.3L34.20,21.5L34.64,21.4L35.07,21.0L35.50,20.9L35.93,20.2L36.37,20.1L36.80,19.6L37.23,19.7L37.67,19.0L38.10,18.6L38.53,18.3L38.96,17.9L39.40,18.0L39.83,17.4L40.26,16.7L40.70,16.5L41.13,18.3L41.56,20.4L42.00,21.5L42.43,22.3L42.86,22.4L43.29,22.9L43.73,22.5L44.16,22.5L44.59,22.6L45.03,22.6L45.46,22.3L45.89,22.3L46.33,22.3L46.76,22.0L47.19,22.1L47.62,22.2L48.06,22.0L48.49,21.9L48.92,21.7L49.36,21.7L49.79,21.9L50.22,21.5L50.65,21.7L51.09,21.7L51.52,21.5L51.95,21.4L52.39,21.3L52.82,21.3L53.25,21.4L53.69,21.5L54.12,21.2L54.55,20.8L54.98,20.9L55.42,21.1L55.85,21.1L56.28,21.0L56.72,20.7L57.15,20.8L57.58,20.3L58.01,20.3L58.45,19.9L58.88,20.2L59.31,20.1L59.75,20.4L60.18,20.2L60.61,20.6L61.05,20.1L61.48,19.7L61.91,19.7L62.34,19.8L62.78,19.6L63.21,19.6L63.64,19.3L64.08,19.6L64.51,19.1L64.94,19.1L65.37,18.9L65.81,18.6L66.24,18.7L66.67,18.5L67.11,18.6L67.54,18.5L67.97,18.3L68.41,18.5L68.84,18.1L69.27,18.4L69.70,18.1L70.14,18.0L70.57,17.7L71.00,17.9L71.44,17.5L71.87,17.6L72.30,17.4L72.73,17.6L73.17,17.4L73.60,17.6L74.03,17.1L74.47,17.0L74.90,17.2L75.33,17.1L75.77,16.7L76.20,16.3L76.63,16.8L77.06,16.7L77.50,16.4L77.93,16.4L78.36,16.5L78.80,16.3L79.23,16.2L79.66,16.0L80.09,16.4L80.53,16.4L80.96,16.2L81.39,15.7L81.83,15.8L82.26,15.9L82.69,15.8L83.13,15.6L83.56,15.7L83.99,15.3L84.42,15.2L84.86,15.5L85.29,15.3L85.72,15.4L86.16,15.0L86.59,14.9L87.02,14.8L87.45,14.7L87.89,15.0L88.32,14.9L88.75,14.7L89.19,14.6L89.62,14.4L90.05,14.6L90.49,14.3L90.92,14.2L91.35,14.0L91.78,13.7L92.22,13.9L92.65,13.9L93.08,13.7L93.52,14.1L93.95,14.0L94.38,14.5L94.81,21.5L95.25,27.6L95.68,29.5L96.11,30.7L96.55,32.0L96.98,32.8L97.41,33.8L97.85,34.3L98.28,35.1L98.71,35.5L99.14,35.9L99.58,36.9",
  driveshaft:
    "M0.00,95.0L0.43,95.1L0.87,95.1L1.30,95.1L1.73,95.1L2.16,95.5L2.60,95.5L3.03,95.4L3.46,94.8L3.90,95.0L4.33,95.0L4.76,95.0L5.20,95.0L5.63,95.0L6.06,95.0L6.49,95.0L6.93,95.0L7.36,95.0L7.79,95.0L8.23,95.0L8.66,95.0L9.09,95.0L9.52,95.0L9.96,95.0L10.39,95.0L10.82,95.0L11.26,95.0L11.69,95.0L12.12,95.0L12.56,95.0L12.99,95.0L13.42,95.0L13.85,95.0L14.29,95.0L14.72,95.0L15.15,95.0L15.59,95.0L16.02,95.0L16.45,95.0L16.88,95.0L17.32,95.0L17.75,95.0L18.18,95.0L18.62,95.0L19.05,95.0L19.48,95.0L19.92,95.0L20.35,95.0L20.78,92.5L21.21,90.7L21.65,93.2L22.08,88.2L22.51,86.6L22.95,83.1L23.38,80.4L23.81,78.9L24.24,77.9L24.68,77.8L25.11,77.4L25.54,77.4L25.98,75.5L26.41,75.1L26.84,74.3L27.28,73.7L27.71,73.2L28.14,71.8L28.57,71.4L29.01,70.0L29.44,68.2L29.87,68.6L30.31,68.2L30.74,68.0L31.17,67.9L31.60,67.6L32.04,66.4L32.47,65.4L32.90,64.7L33.34,65.0L33.77,63.9L34.20,62.8L34.64,63.0L35.07,61.8L35.50,60.7L35.93,60.2L36.37,60.6L36.80,59.5L37.23,59.3L37.67,57.8L38.10,57.4L38.53,57.5L38.96,56.5L39.40,56.8L39.83,55.6L40.26,54.7L40.70,55.2L41.13,53.6L41.56,54.1L42.00,53.2L42.43,52.9L42.86,52.3L43.29,52.4L43.73,51.5L44.16,51.8L44.59,50.6L45.03,50.3L45.46,50.6L45.89,49.8L46.33,49.3L46.76,48.7L47.19,47.8L47.62,47.8L48.06,47.0L48.49,47.2L48.92,46.0L49.36,46.7L49.79,45.8L50.22,45.2L50.65,45.1L51.09,44.8L51.52,44.7L51.95,43.7L52.39,42.7L52.82,43.3L53.25,42.8L53.69,42.0L54.12,42.2L54.55,42.5L54.98,41.3L55.42,41.8L55.85,40.6L56.28,40.9L56.72,39.6L57.15,39.9L57.58,39.2L58.01,39.4L58.45,38.4L58.88,37.6L59.31,37.3L59.75,38.1L60.18,36.9L60.61,36.0L61.05,35.8L61.48,36.0L61.91,35.8L62.34,35.1L62.78,35.0L63.21,35.3L63.64,35.0L64.08,34.2L64.51,32.8L64.94,33.5L65.37,33.2L65.81,33.0L66.24,32.1L66.67,32.5L67.11,31.9L67.54,32.7L67.97,30.6L68.41,31.4L68.84,32.9L69.27,30.4L69.70,30.6L70.14,31.4L70.57,29.9L71.00,28.7L71.44,29.3L71.87,27.8L72.30,29.7L72.73,28.6L73.17,28.8L73.60,28.6L74.03,27.9L74.47,27.6L74.90,26.8L75.33,26.9L75.77,26.3L76.20,26.5L76.63,26.6L77.06,25.2L77.50,25.6L77.93,25.2L78.36,25.9L78.80,25.4L79.23,23.6L79.66,24.1L80.09,24.7L80.53,24.8L80.96,24.8L81.39,23.6L81.83,23.3L82.26,23.0L82.69,23.6L83.13,22.0L83.56,22.2L83.99,21.7L84.42,22.5L84.86,21.9L85.29,22.4L85.72,21.6L86.16,21.1L86.59,21.5L87.02,20.0L87.45,20.8L87.89,19.2L88.32,20.6L88.75,20.0L89.19,20.2L89.62,19.3L90.05,19.7L90.49,18.7L90.92,18.8L91.35,19.3L91.78,20.0L92.22,18.4L92.65,19.1L93.08,18.3L93.52,17.5L93.95,18.3L94.38,17.8L94.81,18.8L95.25,20.3L95.68,18.8L96.11,19.7L96.55,20.6L96.98,22.9L97.41,21.8L97.85,22.1L98.28,23.0L98.71,23.3L99.14,23.1L99.58,23.0",
  throttle:
    "M0.00,90.6L0.43,90.6L0.87,90.6L1.30,90.6L1.73,90.5L2.16,90.6L2.60,90.6L3.03,90.5L3.46,90.5L3.90,90.4L4.33,90.4L4.76,90.4L5.20,90.6L5.63,90.6L6.06,90.6L6.49,90.7L6.93,90.7L7.36,90.6L7.79,90.6L8.23,90.7L8.66,90.7L9.09,90.7L9.52,89.8L9.96,63.4L10.39,25.3L10.82,9.0L11.26,9.0L11.69,9.0L12.12,9.0L12.56,9.0L12.99,9.0L13.42,9.0L13.85,9.1L14.29,9.0L14.72,9.0L15.15,9.2L15.59,9.0L16.02,9.0L16.45,9.1L16.88,9.0L17.32,9.1L17.75,9.0L18.18,9.0L18.62,9.0L19.05,9.0L19.48,9.0L19.92,9.0L20.35,9.1L20.78,9.7L21.21,9.1L21.65,9.0L22.08,9.0L22.51,9.0L22.95,9.0L23.38,9.0L23.81,9.0L24.24,9.0L24.68,9.0L25.11,9.0L25.54,9.0L25.98,9.0L26.41,9.0L26.84,9.0L27.28,9.0L27.71,9.0L28.14,9.0L28.57,9.0L29.01,9.0L29.44,9.0L29.87,9.0L30.31,9.0L30.74,9.0L31.17,9.0L31.60,9.0L32.04,9.0L32.47,9.1L32.90,9.0L33.34,9.0L33.77,9.0L34.20,9.0L34.64,9.0L35.07,9.0L35.50,9.0L35.93,9.0L36.37,9.1L36.80,9.1L37.23,9.1L37.67,9.3L38.10,9.2L38.53,9.2L38.96,9.6L39.40,9.5L39.83,9.5L40.26,9.9L40.70,9.7L41.13,9.7L41.56,10.0L42.00,9.8L42.43,9.6L42.86,9.5L43.29,9.4L43.73,9.9L44.16,9.3L44.59,9.3L45.03,9.7L45.46,9.4L45.89,9.8L46.33,10.0L46.76,9.6L47.19,9.5L47.62,10.2L48.06,9.8L48.49,9.8L48.92,9.8L49.36,10.0L49.79,9.9L50.22,9.8L50.65,9.5L51.09,9.5L51.52,9.7L51.95,9.9L52.39,9.6L52.82,10.0L53.25,10.5L53.69,9.7L54.12,9.4L54.55,9.6L54.98,9.5L55.42,9.3L55.85,9.3L56.28,9.9L56.72,9.8L57.15,9.8L57.58,10.5L58.01,10.1L58.45,9.4L58.88,9.8L59.31,10.3L59.75,9.5L60.18,9.7L60.61,9.8L61.05,9.6L61.48,9.9L61.91,9.3L62.34,9.3L62.78,9.5L63.21,9.4L63.64,9.1L64.08,9.5L64.51,9.2L64.94,9.7L65.37,9.3L65.81,9.1L66.24,9.3L66.67,9.3L67.11,9.4L67.54,9.2L67.97,9.0L68.41,9.1L68.84,9.2L69.27,9.3L69.70,9.2L70.14,9.1L70.57,9.0L71.00,9.0L71.44,9.1L71.87,9.2L72.30,9.0L72.73,9.0L73.17,9.3L73.60,9.3L74.03,9.1L74.47,9.0L74.90,9.0L75.33,9.0L75.77,9.2L76.20,9.2L76.63,9.2L77.06,9.0L77.50,9.0L77.93,9.0L78.36,9.0L78.80,9.0L79.23,9.0L79.66,9.0L80.09,9.0L80.53,9.0L80.96,9.1L81.39,9.0L81.83,9.0L82.26,9.0L82.69,9.0L83.13,9.0L83.56,9.0L83.99,9.0L84.42,9.0L84.86,9.1L85.29,9.0L85.72,9.0L86.16,9.0L86.59,9.0L87.02,9.0L87.45,9.1L87.89,9.0L88.32,9.0L88.75,9.0L89.19,9.0L89.62,9.1L90.05,9.0L90.49,9.0L90.92,9.0L91.35,9.0L91.78,9.0L92.22,9.0L92.65,9.0L93.08,9.0L93.52,9.6L93.95,17.4L94.38,59.1L94.81,95.0L95.25,95.0L95.68,95.0L96.11,95.0L96.55,95.0L96.98,95.0L97.41,95.0L97.85,95.0L98.28,95.0L98.71,95.0L99.14,95.0L99.58,95.0",
  oil: "M0.00,67.4L0.43,66.4L0.87,65.3L1.30,65.0L1.73,64.9L2.16,64.4L2.60,64.0L3.03,63.9L3.46,63.7L3.90,63.3L4.33,63.3L4.76,63.5L5.20,63.5L5.63,63.7L6.06,63.8L6.49,63.9L6.93,64.3L7.36,64.3L7.79,64.4L8.23,64.1L8.66,64.2L9.09,64.3L9.52,64.2L9.96,64.0L10.39,64.5L10.82,63.8L11.26,61.8L11.69,61.1L12.12,59.5L12.56,57.2L12.99,56.8L13.42,55.9L13.85,55.2L14.29,53.4L14.72,53.0L15.15,52.5L15.59,51.8L16.02,51.3L16.45,50.0L16.88,49.9L17.32,51.4L17.75,51.8L18.18,52.0L18.62,51.7L19.05,51.8L19.48,51.8L19.92,51.1L20.35,51.1L20.78,51.2L21.21,49.5L21.65,47.0L22.08,45.8L22.51,43.0L22.95,40.8L23.38,38.8L23.81,38.1L24.24,36.2L24.68,34.5L25.11,33.3L25.54,31.8L25.98,30.7L26.41,29.8L26.84,29.6L27.28,29.0L27.71,28.7L28.14,28.2L28.57,27.9L29.01,28.0L29.44,28.3L29.87,28.2L30.31,28.8L30.74,28.4L31.17,28.4L31.60,27.7L32.04,27.6L32.47,27.8L32.90,27.7L33.34,27.0L33.77,26.2L34.20,26.0L34.64,26.5L35.07,26.4L35.50,25.5L35.93,25.2L36.37,25.2L36.80,24.3L37.23,24.6L37.67,24.4L38.10,23.8L38.53,23.8L38.96,23.6L39.40,23.6L39.83,23.0L40.26,22.4L40.70,22.8L41.13,22.9L41.56,23.8L42.00,24.6L42.43,25.1L42.86,26.2L43.29,26.4L43.73,27.7L44.16,28.2L44.59,27.9L45.03,27.5L45.46,27.7L45.89,28.3L46.33,28.5L46.76,29.0L47.19,28.7L47.62,28.2L48.06,28.6L48.49,29.1L48.92,28.5L49.36,28.3L49.79,28.7L50.22,29.3L50.65,29.0L51.09,29.1L51.52,28.5L51.95,28.9L52.39,29.2L52.82,29.1L53.25,28.8L53.69,29.1L54.12,29.5L54.55,29.2L54.98,29.1L55.42,29.6L55.85,29.4L56.28,29.1L56.72,29.6L57.15,29.6L57.58,29.3L58.01,29.1L58.45,29.3L58.88,29.2L59.31,28.9L59.75,29.0L60.18,28.7L60.61,29.1L61.05,29.5L61.48,28.9L61.91,29.1L62.34,29.3L62.78,29.1L63.21,29.2L63.64,28.4L64.08,29.3L64.51,29.2L64.94,29.7L65.37,29.5L65.81,29.7L66.24,29.6L66.67,29.7L67.11,29.5L67.54,29.6L67.97,29.2L68.41,29.0L68.84,29.1L69.27,29.0L69.70,29.4L70.14,29.2L70.57,29.6L71.00,29.6L71.44,29.5L71.87,29.4L72.30,29.4L72.73,28.9L73.17,29.2L73.60,28.7L74.03,28.5L74.47,28.8L74.90,29.0L75.33,29.3L75.77,29.0L76.20,29.3L76.63,29.5L77.06,29.4L77.50,29.8L77.93,29.9L78.36,30.2L78.80,29.7L79.23,29.4L79.66,29.4L80.09,29.7L80.53,29.9L80.96,30.1L81.39,29.6L81.83,29.6L82.26,29.5L82.69,28.9L83.13,29.3L83.56,29.5L83.99,30.3L84.42,30.4L84.86,30.4L85.29,29.6L85.72,29.7L86.16,29.8L86.59,30.0L87.02,29.6L87.45,29.8L87.89,29.4L88.32,29.5L88.75,29.5L89.19,30.0L89.62,29.7L90.05,29.7L90.49,30.0L90.92,30.0L91.35,29.8L91.78,30.0L92.22,30.1L92.65,30.0L93.08,30.0L93.52,30.2L93.95,30.0L94.38,30.0L94.81,30.8L95.25,31.9L95.68,34.9L96.11,36.8L96.55,39.2L96.98,40.8L97.41,49.2L97.85,58.4L98.28,62.2L98.71,68.6L99.14,74.0L99.58,76.8",
  fuel: "M0.00,48.0L0.43,47.7L0.87,47.6L1.30,47.3L1.73,47.2L2.16,47.1L2.60,47.0L3.03,47.0L3.46,47.1L3.90,47.1L4.33,47.1L4.76,47.1L5.20,47.1L5.63,47.2L6.06,47.4L6.49,47.5L6.93,47.6L7.36,47.6L7.79,47.7L8.23,47.8L8.66,47.7L9.09,47.7L9.52,47.7L9.96,48.0L10.39,48.3L10.82,48.8L11.26,49.4L11.69,49.7L12.12,50.1L12.56,50.3L12.99,50.3L13.42,50.3L13.85,50.2L14.29,49.9L14.72,50.0L15.15,50.0L15.59,49.7L16.02,49.7L16.45,49.7L16.88,49.7L17.32,49.8L17.75,49.8L18.18,49.9L18.62,49.8L19.05,49.6L19.48,49.6L19.92,49.8L20.35,49.7L20.78,50.4L21.21,49.9L21.65,50.2L22.08,50.3L22.51,50.4L22.95,50.7L23.38,51.3L23.81,51.4L24.24,51.6L24.68,51.6L25.11,51.8L25.54,51.8L25.98,52.0L26.41,51.6L26.84,51.6L27.28,51.4L27.71,51.7L28.14,51.6L28.57,51.8L29.01,51.9L29.44,52.0L29.87,52.1L30.31,52.4L30.74,52.2L31.17,52.6L31.60,52.4L32.04,52.3L32.47,52.7L32.90,52.7L33.34,52.6L33.77,52.4L34.20,52.5L34.64,52.3L35.07,52.6L35.50,52.6L35.93,52.7L36.37,52.9L36.80,52.9L37.23,53.1L37.67,53.4L38.10,54.0L38.53,53.8L38.96,53.8L39.40,53.8L39.83,53.9L40.26,54.1L40.70,54.3L41.13,54.0L41.56,54.4L42.00,54.1L42.43,54.0L42.86,53.8L43.29,53.7L43.73,53.6L44.16,53.3L44.59,53.2L45.03,53.4L45.46,53.1L45.89,53.0L46.33,53.0L46.76,53.1L47.19,53.2L47.62,53.2L48.06,53.1L48.49,53.2L48.92,53.3L49.36,53.0L49.79,53.2L50.22,53.3L50.65,53.4L51.09,53.0L51.52,53.2L51.95,53.0L52.39,53.2L52.82,52.8L53.25,52.9L53.69,52.7L54.12,53.0L54.55,53.2L54.98,53.4L55.42,53.2L55.85,53.0L56.28,53.2L56.72,53.2L57.15,53.4L57.58,53.3L58.01,53.5L58.45,53.5L58.88,53.3L59.31,53.6L59.75,53.8L60.18,53.6L60.61,53.9L61.05,53.6L61.48,53.7L61.91,53.7L62.34,53.3L62.78,53.3L63.21,53.6L63.64,53.7L64.08,53.7L64.51,53.4L64.94,53.8L65.37,53.8L65.81,53.9L66.24,54.1L66.67,54.4L67.11,54.1L67.54,54.1L67.97,54.3L68.41,54.4L68.84,54.3L69.27,54.3L69.70,54.2L70.14,54.2L70.57,54.4L71.00,54.5L71.44,54.5L71.87,54.2L72.30,54.1L72.73,53.7L73.17,53.2L73.60,52.8L74.03,52.8L74.47,52.6L74.90,52.6L75.33,53.1L75.77,53.3L76.20,53.3L76.63,53.1L77.06,53.6L77.50,54.1L77.93,54.1L78.36,53.9L78.80,53.6L79.23,53.8L79.66,54.0L80.09,54.0L80.53,54.1L80.96,54.5L81.39,54.9L81.83,54.7L82.26,54.2L82.69,54.1L83.13,54.3L83.56,54.5L83.99,54.3L84.42,54.6L84.86,53.9L85.29,53.4L85.72,53.3L86.16,53.5L86.59,53.5L87.02,53.7L87.45,53.1L87.89,52.8L88.32,52.9L88.75,53.1L89.19,52.8L89.62,52.1L90.05,52.6L90.49,52.3L90.92,52.2L91.35,52.3L91.78,52.3L92.22,52.1L92.65,52.2L93.08,52.7L93.52,52.2L93.95,52.4L94.38,52.9L94.81,52.0L95.25,51.0L95.68,50.1L96.11,49.3L96.55,48.7L96.98,48.3L97.41,47.9L97.85,47.7L98.28,47.4L98.71,47.6L99.14,47.6L99.58,47.5",
  /** A second, slower pass — for showing two runs on one chart. */
  rpmB: "M0.00,68.5L0.43,68.0L0.87,68.1L1.30,68.8L1.73,68.3L2.16,69.2L2.60,68.6L3.03,68.7L3.46,68.6L3.90,69.0L4.33,69.1L4.76,69.3L5.20,69.3L5.63,70.0L6.06,69.6L6.49,70.4L6.93,69.5L7.36,70.3L7.79,70.0L8.23,69.4L8.66,69.6L9.09,69.3L9.52,69.3L9.96,70.0L10.39,68.9L10.82,63.3L11.26,58.5L11.69,56.0L12.12,55.4L12.56,53.8L12.99,52.8L13.42,50.2L13.85,45.5L14.29,44.3L14.72,45.3L15.15,45.6L15.59,45.0L16.02,44.8L16.45,45.1L16.88,44.6L17.32,46.0L17.75,45.5L18.18,45.1L18.62,44.7L19.05,45.7L19.48,44.8L19.92,44.5L20.35,44.4L20.78,39.7L21.21,35.5L21.65,32.5L22.08,30.6L22.51,28.8L22.95,27.9L23.38,27.1L23.81,26.8L24.24,26.3L24.68,26.3L25.12,25.8L25.55,25.8L25.99,25.6L26.42,25.6L26.85,25.4L27.29,25.1L27.72,25.3L28.15,24.7L28.58,24.5L29.03,24.1L29.46,24.1L29.89,23.5L30.33,23.3L30.76,23.5L31.19,23.2L31.63,23.2L32.07,23.3L32.50,22.9L32.93,22.9L33.38,22.8L33.81,22.2L34.24,22.4L34.68,22.3L35.11,21.9L35.55,21.8L35.98,21.1L36.42,21.0L36.86,20.5L37.29,20.6L37.73,19.9L38.16,19.5L38.60,19.2L39.03,18.8L39.47,19.0L39.91,18.4L40.34,17.7L40.78,17.5L41.22,19.3L41.65,21.4L42.10,22.5L42.53,23.3L42.96,23.4L43.40,23.9L43.84,23.5L44.28,23.5L44.71,23.6L45.15,23.7L45.59,23.4L46.02,23.4L46.47,23.4L46.90,23.1L47.34,23.2L47.77,23.3L48.22,23.1L48.65,23.0L49.09,22.8L49.53,22.8L49.97,23.1L50.40,22.7L50.84,22.9L51.28,22.9L51.72,22.7L52.15,22.6L52.60,22.5L53.03,22.5L53.47,22.6L53.92,22.8L54.35,22.5L54.79,22.1L55.22,22.2L55.67,22.4L56.11,22.4L56.54,22.3L56.99,22.0L57.42,22.2L57.86,21.7L58.30,21.7L58.74,21.3L59.18,21.6L59.62,21.5L60.06,21.8L60.50,21.7L60.94,22.1L61.39,21.6L61.82,21.2L62.26,21.2L62.70,21.3L63.14,21.1L63.58,21.2L64.02,20.9L64.47,21.2L64.90,20.7L65.34,20.7L65.78,20.5L66.23,20.3L66.67,20.4L67.10,20.2L67.55,20.3L67.99,20.2L68.43,20.0L68.88,20.3L69.32,19.9L69.75,20.2L70.19,19.9L70.64,19.8L71.08,19.5L71.52,19.8L71.97,19.4L72.41,19.5L72.85,19.3L73.28,19.5L73.73,19.3L74.17,19.6L74.61,19.1L75.06,19.0L75.50,19.2L75.94,19.1L76.39,18.8L76.83,18.4L77.27,18.9L77.71,18.8L78.16,18.5L78.60,18.6L79.04,18.7L79.49,18.5L79.93,18.4L80.37,18.2L80.81,18.7L81.26,18.7L81.70,18.5L82.14,18.0L82.59,18.2L83.03,18.3L83.47,18.2L83.93,18.0L84.37,18.1L84.81,17.8L85.25,17.7L85.70,18.0L86.14,17.8L86.58,18.0L87.03,17.6L87.48,17.5L87.92,17.4L88.36,17.3L88.81,17.7L89.25,17.6L89.69,17.4L90.15,17.3L90.59,17.2L91.03,17.4L91.48,17.1L91.92,17.0L92.37,16.9L92.81,16.6L93.26,16.8L93.70,16.8L94.15,16.7L94.60,17.1L95.04,17.0L95.48,17.5L95.93,24.6L96.38,30.7L96.82,32.6L97.27,33.9L97.72,35.2L98.16,36.0L98.61,37.0L99.06,37.6L99.50,38.4L99.95,38.8L100.00,39.2L100.00,40.3",
} as const;

const STEPS = [
  {
    n: "1",
    title: "Upload your log",
    body: "Pull the log off the Haltech like you always do, then drag the file in. Nothing to install.",
  },
  {
    n: "2",
    title: "Your charts are already set up",
    body: "The charts you built for that car open the way you left them, with your 60-foot, eighth and quarter marked on them.",
  },
  {
    n: "3",
    title: "See what needs attention",
    body: "DragTrace checks the run and lists anything that looked wrong, so you know where to start.",
  },
] as const;

/** In-page anchors for the header, so the page can be skimmed out of order. */
const NAV = [
  { label: "How it works", href: "#how-it-works" },
  { label: "What you get", href: "#features" },
  { label: "Questions", href: "#questions" },
  { label: "Pricing", href: "#pricing" },
] as const;

const SECTIONS = [
  {
    eyebrow: "Saved charts",
    title: "Set up your charts once",
    body: "Most log programs make you start over every time you open a run. DragTrace saves your charts for each car. Open any pass, from any weekend, and you get the same channels, the same colours and the same order.",
    visual: "persist",
  },
  {
    eyebrow: "Alerts",
    title: "Get alerts on what you care about",
    body: "Nobody reads three hundred channels between rounds. Type what matters in plain words — “fuel pressure dropping on the launch.” DragTrace checks every run after that and tells you if it happened, and when.",
    visual: "alerts",
  },
  {
    eyebrow: "Compare",
    title: "Compare passes to each other",
    body: "Pick two passes and they draw on the same chart, lined up at the launch. You can see exactly where one run gained on the other.",
    visual: "compare",
  },
  {
    eyebrow: "Organized",
    title: "All your passes in one place",
    body: "Every car, every race, every pass, kept together. Your quickest ET shows on each race, so you can find the run you want months later.",
    visual: "season",
  },
  {
    eyebrow: "Online",
    title: "Your logs are online, not on one laptop",
    body: "Every pass you upload is stored online. Open it on your phone in the trailer, on the shop computer next week, or at home over the winter. If your laptop dies, your logs are still there.",
    visual: "everywhere",
  },
] as const;

export function Landing({
  onSignIn,
  onLegal,
}: {
  onSignIn: (flow: "signIn" | "signUp") => void;
  onLegal: (page: "privacy" | "terms") => void;
}) {
  const cta =
    "rounded-lg bg-white px-6 py-3 text-base font-semibold text-black transition-colors hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  return (
    <div className="min-h-dvh bg-[#08090a] text-white antialiased">
      <SiteHeader
        onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        onSignIn={onSignIn}
        links={NAV}
      />

      {/* ─────────── Hero ─────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-10 pt-10 lg:pt-16">
        <div className="motion-safe:animate-[fadeUp_0.7s_ease-out_both]">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/55">
            For Haltech drag racers
          </p>
          <h1 className="mt-5 max-w-[17ch] text-balance text-[clamp(2.3rem,5.4vw,3.9rem)] font-semibold leading-[1.03] tracking-[-0.03em]">
            The datalog viewer that has your back.
          </h1>
          <p className="mt-6 max-w-2xl text-xl leading-relaxed text-white/75">
            Upload the log from your Haltech. Your charts open already set up,
            with your 60-foot, eighth and quarter marked on the run — and
            DragTrace tells you if anything looked wrong.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <button onClick={() => onSignIn("signUp")} className={cta}>
              Get started
            </button>
            <p className="text-base text-white/60">$100 a year. Every car you own.</p>
          </div>
        </div>
      </section>

      {/* One real pass, the way DragTrace shows it. */}
      <section className="mx-auto max-w-6xl px-6 pb-8">
        <div className="motion-safe:animate-[fadeUp_0.7s_0.12s_ease-out_both]">
          <PassMockup />
        </div>
        {/* A legend, not a paragraph — three things to match up with the picture. */}
        <ul className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-base text-white/60">
          <li className="flex items-center gap-2.5">
            <span aria-hidden className="h-4 w-px shrink-0 bg-white/80" />
            White line — the launch
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden className="flex shrink-0 overflow-hidden rounded-[2px]">
              {MARKS.map((m) => (
                <span
                  key={m.mark}
                  className="h-2.5 w-2.5"
                  style={{ backgroundColor: m.color }}
                />
              ))}
            </span>
            Coloured bar — your timeslip
          </li>
          <li className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#22c55e] text-[10px] font-bold text-black"
            >
              ✓
            </span>
            Green check — DragTrace found nothing wrong
          </li>
        </ul>
      </section>

      {/* ─────────── How it works ─────────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
        <h2 className="text-[clamp(1.7rem,3.4vw,2.2rem)] font-semibold tracking-[-0.02em]">
          How it works
        </h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="font-mono text-sm text-white/40 tabular-nums">
                {s.n}
              </span>
              <h3 className="mt-2 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-lg leading-relaxed text-white/70">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ─────────── Features ─────────── */}
      <div id="features" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-4">
        <h2 className="border-t border-white/12 pt-16 text-[clamp(1.7rem,3.4vw,2.2rem)] font-semibold tracking-[-0.02em]">
          What you get
        </h2>
        {SECTIONS.map((s) => (
          <section
            key={s.title}
            className="grid items-center gap-10 border-t border-white/12 py-14 first-of-type:border-t-0 first-of-type:pt-10 md:py-16 lg:grid-cols-[1fr_19rem] lg:gap-14"
          >
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/45">
                {s.eyebrow}
              </p>
              <h2 className="mt-4 max-w-2xl text-[clamp(1.8rem,4vw,2.5rem)] font-semibold leading-tight tracking-[-0.02em]">
                {s.title}
              </h2>
              <p className="mt-5 max-w-xl text-xl leading-relaxed text-white/75">
                {s.body}
              </p>
            </div>
            <SectionVisual kind={s.visual} />
          </section>
        ))}
      </div>

      {/* ─────────── Reassurance ─────────── */}
      <section id="questions" className="scroll-mt-20 border-t border-white/12">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-[clamp(1.7rem,3.4vw,2.2rem)] font-semibold tracking-[-0.02em]">
            Questions
          </h2>
          <div className="mt-8 grid gap-10 md:grid-cols-3">
            {[
              {
                q: "I am not good with computers.",
                a: "That is who this is built for. Nothing to install. You set your charts up once for each car, and after that they are just there. You can even take a picture of your timeslip and it fills in the numbers for you.",
              },
              {
                q: "Do I still need my laptop?",
                a: "Yes, to pull the log off the Haltech, same as you do now. After that you are done with it. Upload the file and read the run on your phone or your tablet, right there in the trailer.",
              },
              {
                q: "Will it work with my ECU?",
                a: "Right now, Haltech only. We are adding more later — Holley, AEM, MoTeC and Fueltech.",
              },
            ].map((f) => (
              <div key={f.q}>
                <h3 className="text-xl font-semibold">{f.q}</h3>
                <p className="mt-2 text-lg leading-relaxed text-white/70">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── The stripe: price ─────────── */}
      <section id="pricing" className="scroll-mt-20 border-t border-white/12">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/45">
            Pricing
          </p>
          <h2 className="mt-4 text-[clamp(2.2rem,6vw,3.6rem)] font-semibold leading-none tracking-[-0.03em]">
            $100 a year.
          </h2>
          <p className="mt-5 max-w-xl text-xl leading-relaxed text-white/75">
            That is the whole thing. Every car you own, every race, every pass.
            No add-ons and no per-car charge.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <button onClick={() => onSignIn("signUp")} className={cta}>
              Get started
            </button>
            <button
              onClick={() => onSignIn("signIn")}
              className="rounded-lg px-2 py-3 text-base text-white/70 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
            >
              I already have an account
            </button>
          </div>
        </div>
      </section>

      <SiteFooter onLegal={onLegal} />

      <style>{`
        html { scroll-behavior: smooth; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  );
}

/* ══════════════════ The pass ══════════════════ */

function Chart({
  series,
  marks = true,
  className = "",
}: {
  series: { d: string; color: string; width?: number; band?: [number, number] }[];
  marks?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`h-full w-full ${className}`}
      aria-hidden
    >
      {/* The launch. The viewer draws this on every trace. */}
      {marks && (
        <line
          x1={LAUNCH_X}
          x2={LAUNCH_X}
          y1="0"
          y2="100"
          stroke="#ffffff"
          strokeOpacity="0.7"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {marks &&
        MARKS.map((m) => (
          <line
            key={m.mark}
            x1={markX(m.at)}
            x2={markX(m.at)}
            y1="0"
            y2="100"
            stroke={m.color}
            strokeOpacity="0.45"
            strokeWidth="0.4"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {series.map((s) => {
        // Each channel owns its own y-axis in the real viewer, so a band keeps
        // two noisy signals from drawing through each other.
        const [top, height] = s.band ?? [0, 100];
        const path = (
          <path
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 1.6}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
        return s.band ? (
          <g key={s.d} transform={`translate(0 ${top}) scale(1 ${height / 100})`}>
            {path}
          </g>
        ) : (
          <g key={s.d}>{path}</g>
        );
      })}
    </svg>
  );
}

function ChannelRow({
  color,
  name,
  value,
  unit,
}: {
  color: string;
  name: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs leading-tight">
      <span
        className="h-2.5 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1 truncate text-white/70">{name}</span>
      <span className="shrink-0 font-mono font-medium tabular-nums text-white">
        {value}
      </span>
      <span className="w-7 shrink-0 font-mono text-[10px] text-white/45">{unit}</span>
    </div>
  );
}

/** The viewer, on one pass. */
function PassMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-white/14 bg-[#0d0e10] shadow-[0_40px_100px_-30px_rgba(0,0,0,1)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-white/55">
        <span>Shop Car</span>
        <span className="text-white/25">›</span>
        <span>Spring Nationals</span>
        <span className="text-white/25">›</span>
        <span className="font-mono text-white/85">Q1</span>
        {/* It checked. This one is clean — which is its own kind of good news. */}
        <span className="ml-auto flex items-center gap-1.5 rounded-md border border-white/12 px-2 py-0.5">
          <span className="flex size-4 items-center justify-center rounded-full bg-[#22c55e] text-[10px] font-bold text-black">
            ✓
          </span>
          <span className="text-white/70">No alerts</span>
        </span>
      </div>

      {/* Engine, with the timeslip band under it */}
      <div className="flex border-b border-white/10">
        <div className="min-w-0 flex-1 p-1.5">
          <div className="h-32 sm:h-44">
            <Chart
              series={[
                { d: CURVES.rpm, color: "#ef4444" },
                { d: CURVES.driveshaft, color: "#3b82f6" },
                // Throttle is a percentage on its own axis, so it rides above
                // the two RPM channels instead of tangling with them.
                { d: CURVES.throttle, color: "#22c55e" },
              ]}
            />
          </div>
          {/* The timeslip, drawn to scale from the hit to the stripe. */}
          <div className="relative mt-1 h-4">
            {MARKS.map((m, i) => {
              const from = i === 0 ? LAUNCH_X : markX(MARKS[i - 1].at);
              const to = markX(m.at);
              return (
                <div
                  key={m.mark}
                  className="absolute inset-y-0 flex items-center justify-center overflow-hidden whitespace-nowrap font-mono text-[8px] font-semibold text-black/80"
                  style={{
                    left: `${from}%`,
                    width: `${to - from}%`,
                    backgroundColor: m.color,
                  }}
                >
                  {m.mark}
                </div>
              );
            })}
          </div>
        </div>
        <div className="hidden w-52 shrink-0 flex-col gap-1 border-l border-white/10 bg-black/25 p-2 sm:flex">
          <div className="mb-0.5 flex items-center gap-1.5 border-b border-white/10 pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
            Channels <span className="ml-auto tabular-nums text-white/35">3</span>
          </div>
          <ChannelRow color="#ef4444" name="RPM" value="8330" unit="rpm" />
          <ChannelRow color="#3b82f6" name="Driveshaft RPM" value="8080" unit="rpm" />
          <ChannelRow color="#22c55e" name="Throttle Position" value="100.0" unit="%" />
        </div>
      </div>

      {/* Pressures, where an alert fired */}
      <div className="flex">
        <div className="relative min-w-0 flex-1 p-1.5">
          <div className="h-20 sm:h-28">
            <Chart
              series={[
                { d: CURVES.oil, color: "#f59e0b", band: [0, 48] },
                { d: CURVES.fuel, color: "#14b8a6", band: [52, 48] },
              ]}
            />
          </div>
          {/* This pass is clean — fuel holds within about 2 psi the whole way —
              so nothing is flagged on it. */}
        </div>
        <div className="hidden w-52 shrink-0 flex-col gap-1 border-l border-white/10 bg-black/25 p-2 sm:flex">
          <div className="mb-0.5 flex items-center gap-1.5 border-b border-white/10 pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
            Channels <span className="ml-auto tabular-nums text-white/35">2</span>
          </div>
          <ChannelRow color="#f59e0b" name="Oil Pressure" value="88.4" unit="psi" />
          <ChannelRow color="#14b8a6" name="Fuel Pressure" value="42.3" unit="psi" />
        </div>
      </div>
    </div>
  );
}

/* ══════════════════ Section visuals ══════════════════ */

const CARD = "rounded-lg border border-white/12 bg-[#101113] p-3";
const CAPTION = "font-mono text-[10px] uppercase tracking-[0.16em] text-white/45";

function SectionVisual({ kind }: { kind: string }) {
  if (kind === "persist") {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {["Q1 · April", "E2 · August"].map((label) => (
          <div key={label} className={CARD}>
            <p className={CAPTION}>{label}</p>
            <div className="mt-2 h-14">
              <Chart
                marks={false}
                series={[
                  { d: CURVES.rpm, color: "#ef4444", width: 1.2 },
                  { d: CURVES.driveshaft, color: "#3b82f6", width: 1.2 },
                ]}
              />
            </div>
            <p className="mt-2 font-mono text-[10px] text-white/40">
              RPM · Driveshaft
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "alerts") {
    return (
      <div className="space-y-2.5">
        <div className={CARD}>
          <p className={CAPTION}>You type</p>
          <p className="mt-2 text-sm leading-snug text-white/85">
            “fuel pressure dropping on the launch”
          </p>
        </div>
        <div className="flex justify-center text-white/30" aria-hidden>
          ↓
        </div>
        <div className={CARD}>
          <p className={CAPTION}>Every run after that</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px] bg-[#f59e0b]" />
            <span className="min-w-0 flex-1 truncate text-sm text-white/80">
              Fuel pressure down at the hit
            </span>
            <span className="font-mono text-xs tabular-nums text-white/50">
              0.31s
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "compare") {
    return (
      <div className={CARD}>
        <p className={CAPTION}>Two runs, one chart</p>
        <div className="mt-2 h-28">
          <Chart
            series={[
              { d: CURVES.rpmB, color: "#3b82f6", width: 1.4 },
              { d: CURVES.rpm, color: "#ef4444", width: 1.4 },
            ]}
          />
        </div>
        <div className="mt-2.5 space-y-1">
          {[
            { tag: "Q1", et: "7.114", color: "#ef4444" },
            { tag: "E2", et: "7.147", color: "#3b82f6" },
          ].map((r) => (
            <div key={r.tag} className="flex items-center gap-2 text-xs">
              <span
                className="h-0.5 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              <span className="flex-1 font-mono uppercase tracking-wider text-white/65">
                {r.tag}
              </span>
              <span className="font-mono tabular-nums text-white/90">{r.et}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (kind === "everywhere") {
    return (
      <div className={CARD}>
        <p className={CAPTION}>Same account, same charts</p>
        <div className="mt-2 space-y-1.5">
          {[
            { where: "Phone", when: "in the trailer" },
            { where: "Shop computer", when: "next week" },
            { where: "Home", when: "over the winter" },
          ].map((p) => (
            <div
              key={p.where}
              className="flex items-baseline gap-2 rounded-md border border-white/10 px-2 py-1.5"
            >
              <p className="min-w-0 flex-1 truncate text-sm text-white/85">
                {p.where}
              </p>
              <p className="font-mono text-[10px] text-white/40">{p.when}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <p className={CAPTION}>Shop Car</p>
      <div className="mt-2 space-y-1.5">
        {[
          { name: "Spring Nationals", runs: "8 passes", et: "7.114" },
          { name: "Division 6 points", runs: "6 passes", et: "7.142" },
          { name: "Test & tune", runs: "4 passes", et: "7.208" },
        ].map((e) => (
          <div
            key={e.name}
            className="flex items-baseline gap-2 rounded-md border border-white/10 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white/85">{e.name}</p>
              <p className="font-mono text-[10px] text-white/40">{e.runs}</p>
            </div>
            <div className="text-right">
              <p className={CAPTION}>Best</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-white">
                {e.et}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
