import { Component, type ReactNode } from "react";

/**
 * For pieces mounted outside the page's error screen (the chart pop-up, the stock panel):
 * if one of them breaks, it disappears and the rest of the app keeps working.
 */
export default class QuietBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error(`${this.props.name} failed:`, error); }
  render() { return this.state.failed ? null : this.props.children; }
}
