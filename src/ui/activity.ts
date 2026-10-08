/** Something long the plugin is doing, shown on the dashboard and in a notice. */
export interface Activity {
  /** "Organizing". */
  title: string;
  /** "AI is placing notes: 3 of 12 requests". */
  detail: string;
  /** Progress, when it can be counted. */
  done?: number;
  total?: number;
  /** The user can stop it. */
  stoppable: boolean;
}
