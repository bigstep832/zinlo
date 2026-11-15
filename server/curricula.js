function week(number, title, preparation, tasks) {
  return { week: number, title, preparation, tasks: tasks.map(([title, description, criteria], i) => ({ id: `week-${number}-task-${i + 1}`, week: number, title, description, criteria })) };
}
export const tracks = [
  { id: 'python', title: 'Python Foundations', description: 'Learn functions, collections, and file storage by building a practical command-line tool.', project: 'A command-line habit tracker', prerequisite: 'No previous coding experience required.', weeks: [
    week(1, 'Create and list habits', 'Install Python 3. Run a short script that prints your name. Bring one habit you would like to track.', [
      ['Add a habit', 'Create an add_habit function that accepts a name and stores it in a list. Call it with two examples.', 'Two distinct habits can be added; blank names are rejected.'],
      ['Show the habit list', 'Build a simple menu that lists habits and lets the user add another one until they choose to exit.', 'The menu supports add, list, and exit without restarting the script.']
    ]),
    week(2, 'Record daily completion', 'Review dictionaries and function arguments. Sketch the data needed for a habit and its completion dates.', [
      ['Mark a habit complete', 'Give each habit a stable identifier and record completion for a selected date.', 'A chosen habit can be marked complete without changing other habits.'],
      ['Show a daily summary', 'Display which habits were completed today. Handle a second completion attempt politely.', 'The daily summary is accurate and the same date is never stored twice.']
    ]),
    week(3, 'Keep data between runs', 'Read the Python json module introduction. Make a copy of your existing program before changing storage.', [
      ['Save habits to a file', 'Serialize habits and completion records to a JSON file after a change.', 'Saved JSON contains names, identifiers, and completion dates.'],
      ['Load data safely', 'Load the JSON file on startup and handle a missing or damaged file without silently destroying data.', 'Restarting preserves habits; a damaged file produces a clear recovery message.']
    ]),
    week(4, 'Make it reliable and share it', 'List five ways input could be invalid. Ask a teammate to try the app with unusual values.', [
      ['Handle errors', 'Check unknown menu choices, missing identifiers, duplicate names, and invalid dates. Write down expected outcomes.', 'Five concrete examples run without an unhandled exception.'],
      ['Publish a runnable project', 'Add a README with setup, examples, limits, and a short demonstration. Share code or a written walkthrough.', 'A teammate can follow the instructions and complete add, mark, save, and reload.']
    ])
  ]},
  { id: 'javascript', title: 'JavaScript Foundations', description: 'Learn JavaScript and browser events by building a personal task planner.', project: 'A browser task planner', prerequisite: 'Use the provided HTML/CSS starter; previous HTML/CSS knowledge is optional.', starterUrl: '/starter.html', weeks: [
    week(1, 'Add and display tasks', 'Download the HTML/CSS starter and open it in a browser. Find the form, input, and list in the markup.', [
      ['Capture a new task', 'Listen to the starter form submit event, prevent page reload, trim the input, and store a task object.', 'Submitting a nonempty title adds one task; blank input gives a useful message.'],
      ['Render the task list', 'Create a renderTasks function that draws the current array using safe textContent.', 'Two tasks appear after submission and typed markup is shown as text.']
    ]),
    week(2, 'Complete and organize tasks', 'Review array find, filter, and map. Give each task a stable id.', [
      ['Toggle completion', 'Add a checkbox or button that updates only the selected task and re-renders the list.', 'Tasks can be completed and reopened independently.'],
      ['Filter your list', 'Add All, Active, and Completed controls plus a remaining-task count.', 'Switching filters preserves all tasks and the count matches active work.']
    ]),
    week(3, 'Persist and validate', 'Inspect browser localStorage in developer tools. Decide what should happen on the first visit.', [
      ['Save tasks locally', 'Store task data as JSON whenever a task changes and restore it on page load.', 'Tasks and completion status survive a browser refresh.'],
      ['Handle damaged data', 'Wrap parsing in error handling, validate stored task shapes, and provide a recovery action.', 'Invalid storage does not crash the page or erase data without explanation.']
    ]),
    week(4, 'Finish and share', 'Use the planner with a keyboard and on a narrow browser window. Record confusing moments.', [
      ['Make the planner accessible', 'Label controls, keep visible focus, show form errors, and make layout work on a phone-width screen.', 'Core add, complete, and filter actions are usable with the keyboard alone.'],
      ['Document and demonstrate', 'Write a README, describe local-only storage limits, and share a link, source file, or walkthrough.', 'A teammate can run the app and recover their task list after refresh.']
    ])
  ]},
  { id: 'ai', title: 'AI Apps with Python', description: 'Build one small assistant using an existing model, structured inputs, and tested outputs.', project: 'A focused AI assistant', prerequisite: 'Basic Python functions, collections, and error handling required. Mock responses are free; a real model API requires your own provider account and may incur separate usage charges.', weeks: [
    week(1, 'Define a narrow assistant', 'Choose one task, such as summarizing meeting notes. Use synthetic examples instead of personal or confidential information.', [
      ['Write an input/output contract', 'Describe what the assistant accepts, what it returns, and three cases it should refuse or flag for review.', 'The scope and output fields are clear, with three sample input/output pairs.'],
      ['Build a mock provider', 'Write a Python function that returns fixed sample model responses and a command-line entry point.', 'The complete app runs with sample responses and needs no paid API account.']
    ]),
    week(2, 'Call a model safely', 'Read the chosen provider documentation and prices. Keep credentials outside source code; use a small spending limit.', [
      ['Add a provider adapter', 'Keep mock mode working. Optionally add one HTTPS API call using a server-side environment key, timeout, and error handling.', 'Mock mode always works; real mode never prints a key and reports missing configuration clearly.'],
      ['Validate the answer', 'Define required output fields, parse a model response, and reject malformed or missing fields.', 'Valid samples pass, and three malformed samples produce actionable errors.']
    ]),
    week(3, 'Evaluate useful behavior', 'Create a small evaluation set of ordinary, ambiguous, and adversarial inputs. Include expected qualities rather than one exact wording.', [
      ['Run an evaluation set', 'Test at least six inputs and record whether outputs meet your criteria. Separate model output from verified facts.', 'A table records inputs, observed outputs, and clear pass/fail explanations.'],
      ['Improve instructions', 'Revise one instruction based on the failures, rerun the same examples, and compare the results.', 'Changes are justified by observed examples; unresolved limitations are documented.']
    ]),
    week(4, 'Handle failure and demonstrate', 'Try unavailable network, timeout, empty response, and oversized input. Decide when a human must review output.', [
      ['Add recovery paths', 'Set an input size limit, cap retry attempts, handle unavailable providers, and preserve user input on failure.', 'The app fails clearly without infinite retries, hidden costs, or lost input.'],
      ['Ship the small assistant', 'Document setup, mock mode, optional API costs, privacy limitations, and examples. Record or write a short demo.', 'A teammate can run the free mock demo and understand what real API use requires.']
    ])
  ]}
];
export const trackById = id => tracks.find(track => track.id === id);
export function basePlan(trackId, level) {
  const plan = { source: 'base', weeks: structuredClone(trackById(trackId).weeks) };
  if (level === 'basics' && trackId !== 'ai') for (const w of plan.weeks) w.preparation += ' Since you know the basics, bring one edge case and explain the trade-offs in your solution.';
  return plan;
}
