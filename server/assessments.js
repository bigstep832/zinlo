// Original, low-stakes practice questions. Answer keys stay on the server.
// First option below is correct; buildQuiz rotates display order deterministically.
const question = (prompt, options, explanation) => ({ prompt, options, explanation });
const python = [
  [
    question('What does input() return when the learner types Read?', ['The string "Read"', 'A variable named Read', 'A list containing Read'], 'input() returns text. Assign it to a variable if you want to use it later.'),
    question('What is the result of "  Walk  ".strip()?', ['"Walk"', '"  Walk  "', '"W a l k"'], 'strip() removes whitespace at the edges, not spaces inside a name.'),
    question('A user submits only spaces. What should your habit prompt do?', ['Ask for a nonempty name after trimming', 'Store the spaces as a habit', 'End with a traceback'], 'Validate the trimmed input before storing it.'),
  ],
  [
    question('Which operation adds "Read" to an existing habits list?', ['habits.append("Read")', 'habits = "Read"', 'print("Read")'], 'append adds an item; assignment replaces the variable, and print only displays text.'),
    question('Why use enumerate(habits, start=1)?', ['To display a number alongside each habit', 'To save the list to disk', 'To remove empty names'], 'enumerate supplies a count and the item; start=1 makes the displayed count begin at one.'),
    question('A program only keeps a list in memory. What happens after restarting it?', ['The list must be created again unless it was saved', 'Python automatically restores the list', 'The last printed list becomes a file'], 'Variables alone do not persist between program runs.'),
  ],
  [
    question('Where should the menu prompt go so the learner can choose repeatedly?', ['Inside the while loop', 'Only before the loop', 'Only after the loop'], 'A prompt inside the loop runs on each iteration.'),
    question('What does break do inside the menu loop?', ['Exits that loop', 'Skips all validation forever', 'Restarts Python'], 'break stops the nearest enclosing loop; it is useful for a quit command.'),
    question('The menu receives an unknown command. What is a useful response?', ['Explain the valid choices and show the menu again', 'Silently treat it as quit', 'Erase the habits list'], 'An invalid command should preserve data and let the user recover.'),
  ],
  [
    question('Why give every habit a stable ID?', ['To identify the same habit even if display order changes', 'To make every habit have the same name', 'To avoid storing completion dates'], 'A stable ID identifies a record independently of its current list position.'),
    question('The same habit is marked done twice today. What should happen?', ['Today appears only once in its completion dates', 'The second action adds another identical date', 'All other habits become done'], 'Check whether today is already recorded before appending it.'),
    question('What makes mark_done(habits, habit_id, today) easier to test?', ['Its inputs make the target habit and date explicit', 'It always changes every habit', 'It reads an unrelated global variable'], 'Explicit inputs let you test a specific ID and date without hidden dependencies.'),
  ],
  [
    question('What does json.dumps(habits) produce?', ['JSON text representing the records', 'A saved file by itself', 'A new Python function'], 'Serialization produces text; writing that text to a file is a separate action.'),
    question('When should a changed habit list be saved?', ['After a successful change', 'Only before any changes', 'After displaying an error for invalid input'], 'Save the accepted state so the next run can restore it.'),
    question('Why write a complete temporary file before replacing the old save?', ['To reduce the chance of leaving a partly written main file', 'To guarantee every filesystem failure is impossible', 'To avoid validating the data'], 'Replacement reduces partial-write risk, but errors still need handling and data still needs validation.'),
  ],
  [
    question('What is a reasonable first-run response to a missing habits.json?', ['Start with an empty list', 'Pretend a damaged file was loaded successfully', 'Crash before showing the menu'], 'A missing file can mean that the learner has not saved anything yet.'),
    question('Existing JSON is damaged. What should the program do?', ['Report the problem and preserve the file for inspection', 'Overwrite it with an empty list immediately', 'Hide the error and report success'], 'A parsing failure is different from a missing file. Preserve potentially recoverable work.'),
    question('Why validate records after JSON parsing succeeds?', ['Valid JSON may still contain the wrong record shape', 'Parsing guarantees every habit has a unique ID', 'Validation converts every string into a date'], 'JSON syntax does not enforce your application’s IDs, fields or date rules.'),
  ],
  [
    question('Which is a repeatable test case?', ['Blank name → show a message and keep the list unchanged', 'The program should feel nice', 'Click around and hope nothing fails'], 'A repeatable case has a concrete input and observable expected result.'),
    question('What does an expected-versus-actual test log help you do?', ['Identify a specific mismatch and check the fix', 'Prove that every possible input works', 'Replace running the program'], 'Record what happened, then rerun that same case after a change.'),
    question('A name limit is 60 characters. Which cases check its boundary?', ['A 60-character name and a 61-character name', 'Only a 10-character name', 'Only an empty name'], 'Test at the limit and just beyond it, as well as ordinary and empty inputs.'),
  ],
  [
    question('What does a teammate need in the project guide?', ['Setup steps, run command, an example and limitations', 'Only a screenshot of the title', 'Your private credentials'], 'A useful guide makes the project runnable and describes what it does and does not do.'),
    question('How can you check that persistence works in your demo?', ['Add a habit, close the program, restart and inspect it', 'Print the same list twice in one run', 'Rename the file without loading it'], 'A real restart tests saving and loading together.'),
    question('Which limitation should a local-file tracker explain?', ['Its data stays in the local project file, without automatic account sync', 'Its data is automatically synchronized everywhere', 'Its tests guarantee it never fails'], 'Describe the actual storage model and avoid promising capabilities you did not build.'),
  ],
];

const ai = [
  [
    question('Which is a bounded task for an AI drafting tool?', ['Turn four fictional notes into a five-line draft to review', 'Decide every important matter without human review', 'Invent missing facts so an update looks complete'], 'A small transformation with known facts and review criteria is easier to check.'),
    question('An answer sounds confident. What does that establish?', ['Its tone, not whether its claims are accurate', 'That all its claims have been verified', 'That it has permission to act for you'], 'Fluent wording is not evidence or authorization.'),
    question('What is the best material for practising this course?', ['Fictional or appropriately non-sensitive examples', 'A colleague’s private information without permission', 'An account password to make the prompt realistic'], 'Practise the skill without exposing unnecessary personal or confidential details.'),
  ],
    [
    question('Which prompt is most checkable?', ['Draft under 60 words using only these facts; mark unknowns', 'Make this amazing and fill any gaps', 'Write anything professional'], 'State the task, source context, limits and output format.'),
    question('A draft adds a deadline absent from the notes. What should you do?', ['Remove or verify it instead of accepting it as a fact', 'Keep it because it sounds specific', 'Assume the tool has private knowledge'], 'A missing date should remain unknown until it is confirmed.'),
    question('You change a message’s tone. What must remain intact?', ['Its factual content, commitments and uncertainty', 'Only its word count', 'Every invented detail in the first draft'], 'Style changes should not silently change meaning.'),
  ],
  [
    question('Notes say "Maybe test on Friday." Which summary preserves this?', ['A Friday test is proposed, not confirmed', 'The test will definitely happen Friday', 'The test already happened Friday'], 'Preserve the difference between a suggestion, a decision and a completed event.'),
    question('An action has no named owner. What belongs in the summary?', ['Owner: not yet assigned', 'A plausible colleague’s name', 'The name from an unrelated task'], 'Unknown information is useful when clearly labelled; inventing it creates false commitments.'),
    question('How should you review a summary?', ['Compare each decision and action with the source notes', 'Check only whether it reads smoothly', 'Ask for a more confident tone'], 'Trace the summary back to the facts and keep uncertainty visible.'),
  ],
    [
    question('A response includes a source link. What is the next verification step?', ['Open it and check that it supports the exact claim', 'Treat the link itself as proof', 'Check only that the domain sounds familiar'], 'A citation may be irrelevant or inaccurate; read the supporting passage and context.'),
    question('Why check a source’s date for a claim that may change?', ['It may describe an older situation', 'Every old source is automatically false', 'Newer wording always guarantees accuracy'], 'Recency matters when the underlying fact changes, alongside relevance and evidence.'),
    question('You cannot find support for an important claim. What should your record say?', ['Unverified, with the missing evidence noted', 'Confirmed because two generated answers agree', 'True until someone objects'], 'Agreement between generated texts does not replace independent evidence.'),
  ],
  [
    question('A plan has 30, 25 and 20 minutes of tasks but only 60 minutes available. What is wrong?', ['The tasks need 75 minutes before any buffer', 'The tasks fit exactly', 'The total does not matter if the format looks clear'], 'Add the durations yourself and include transitions or buffer where needed.'),
    question('A generated plan assumes a tool you do not have. What should you do?', ['Revise the plan around available resources', 'Ignore the constraint', 'Mark the task complete anyway'], 'A useful plan respects real time, resource and dependency constraints.'),
    question('Why include a small buffer?', ['To account for transitions or uncertainty', 'To guarantee no delay can ever happen', 'To hide tasks that do not fit'], 'A buffer makes assumptions visible; it does not make the schedule certain.'),
  ],
  [
    question('How can you compare two prompt versions fairly?', ['Use the same test inputs and review criteria', 'Use easy inputs for the new version only', 'Compare only how long the answers are'], 'Keep the evaluation conditions stable so differences are meaningful.'),
    question('Why change one instruction at a time?', ['To make the effect of that change easier to understand', 'To guarantee the next result is perfect', 'To avoid checking the output'], 'Small controlled changes help identify what improved or worsened.'),
    question('A revision fixes one case but fails another. What should you record?', ['Both the improvement and the remaining failure', 'Only the successful case', 'That every case now passes'], 'A useful evaluation includes trade-offs and failures, not just attractive examples.'),
  ],
  [
    question('Which order describes a responsible drafting workflow?', ['Prepare input → draft → check → make a human decision', 'Draft → publish automatically → check later', 'Publish → invent supporting facts'], 'Review and the decision to use the result come before acting on it.'),
    question('What should a manual fallback explain?', ['How to finish the task if the tool is unavailable or unsuitable', 'How to bypass every access restriction', 'Why the learner should abandon all work'], 'The fallback keeps the task possible without depending on one tool.'),
    question('Which checklist item is observable?', ['Every deadline matches a source fact or is marked unknown', 'The output seems intelligent', 'The text looks impressive'], 'Concrete checks are easier to apply consistently.'),
  ],
  [
    question('What belongs in a practical AI playbook?', ['A reusable prompt, worked examples, review checks and limits', 'Only the tool’s marketing claims', 'A promise of perfect accuracy'], 'Show the workflow and evidence of review, not just the final polished text.'),
    question('Why keep the original draft beside your corrected version?', ['To show what you checked and changed', 'To prove the tool can never make a mistake', 'To replace the source facts'], 'Before-and-after evidence makes your review process visible.'),
    question('Which final statement is honest?', ['These examples worked after review; these cases still need care', 'This prompt guarantees correct answers for every topic', 'Human judgment is no longer needed'], 'Describe the tested scope and unresolved limitations.'),
  ],
];

const spanish = [
  [
    question('Which phrase introduces your name?', ['Me llamo Ana.', '¿Cuánto cuesta?', 'La cuenta, por favor.'], 'Me llamo… means My name is…; change Ana to your name.'),
    question('How do you ask where someone is from?', ['¿De dónde eres?', '¿Qué hora es?', '¿Dónde está el café?'], '¿De dónde eres? asks about origin. ¿Dónde está…? asks about location.'),
    question('Choose a suitable reply to "Mucho gusto."', ['Igualmente.', 'Dos cafés.', 'A la derecha.'], 'Igualmente means likewise and works as a polite response.'),
  ],
  [
    question('Which says "I like music"?', ['Me gusta la música.', 'Soy la música.', 'Tengo la música cuesta.'], 'Me gusta + a singular noun is a useful chunk for expressing a preference.'),
    question('How do you ask someone to speak more slowly?', ['Más despacio, por favor.', 'Hasta mañana.', 'Me llamo despacio.'], 'Más despacio, por favor is a polite request to slow down.'),
    question('Which sentence describes a routine?', ['Trabajo por la mañana.', '¿Cuánto cuesta el pan?', 'A la izquierda.'], 'Trabajo por la mañana means I work in the morning.'),
  ],
    [
    question('Which is a polite café order?', ['Un café, por favor.', '¿De dónde eres café?', 'Soy cuenta.'], 'Naming the item followed by por favor is a simple polite order.'),
    question('How do you ask for the bill?', ['La cuenta, por favor.', 'Hasta luego.', 'Me gusta la calle.'], 'La cuenta is the bill in this café context.'),
    question('What does "¿Tienen té?" ask?', ['Do you have tea?', 'Where is the station?', 'What is your name?'], '¿Tienen…? is a useful way to ask whether an item is available.'),
  ],
  [
    question('What does "¿Cuánto cuesta?" mean?', ['How much does it cost?', 'Where are you from?', 'When do you work?'], 'Use it to ask the price of one item.'),
    question('You hear "tres euros." Which amount is that?', ['3 euros', '13 euros', '30 euros'], 'Tres is three; trece is thirteen and treinta is thirty.'),
    question('You are unsure of the total. Which response helps?', ['¿Cinco euros en total?', 'Sí, without checking', 'Me llamo total.'], 'Repeating the amount as a question gives the other person a chance to confirm or correct it.'),
  ],
  [
    question('Which asks where the station is?', ['¿Dónde está la estación?', '¿De dónde eres?', '¿Cuánto cuesta la estación?'], '¿Dónde está…? asks about the location of a place.'),
    question('What does "a la derecha" mean?', ['To the right', 'To the left', 'Straight ahead'], 'Derecha is right; izquierda is left; todo recto is straight ahead.'),
    question('You missed part of a route. What is useful to say?', ['¿Puede repetir, por favor?', 'I understood, even when you did not', 'La cuenta, por favor.'], 'Ask for repetition instead of pretending to understand the directions.'),
  ],
  [
    question('What does "¿Quieres tomar un café?" do?', ['Invites someone to have coffee', 'Asks for the price of coffee', 'Introduces your name'], '¿Quieres…? can introduce a simple invitation.'),
    question('Which confirms both time and place?', ['Entonces, el sábado a las tres en el café.', 'Sí, algún día.', 'Me gusta.'], 'Repeating the day, time and place checks the shared plan.'),
    question('You cannot come on Friday. Which is a useful response?', ['No puedo el viernes. ¿El sábado?', 'Sí, el viernes, although you cannot come', '¿Cuánto cuesta?'], 'State the constraint and suggest an alternative.'),
  ],
  [
    question('What can you say when you do not understand?', ['No entiendo. ¿Puede repetir?', 'Sí to every question', 'Tengo cuenta derecha.'], 'A repair phrase keeps the conversation accurate and gives your partner a way to help.'),
    question('How can you check a detail you think you heard?', ['Repeat it as a short question', 'Change the subject immediately', 'Assume every detail is right'], 'Confirmation is useful even when your vocabulary is limited.'),
    question('What is a realistic aim for a short beginner dialogue?', ['Complete a familiar exchange with help and repair phrases', 'Never pause or ask for help', 'Understand every accent and topic'], 'Successful supported communication is a better target than pretending to be fluent.'),
  ],
    [
    question('What makes a personal phrasebook useful?', ['Grouping phrases by situation with their meaning and an example', 'Listing unfamiliar words without context', 'Including only phrases you cannot explain'], 'Situations and examples help you choose a phrase during a real exchange.'),
    question('What should a final practice conversation include?', ['A familiar exchange and a chance to clarify a detail', 'Only reading your own name once', 'A promise never to make mistakes'], 'Demonstrate both useful phrases and a strategy for recovering from confusion.'),
    question('Which describes progress after this short course honestly?', ['I can practise familiar exchanges with support and know what to work on next', 'I am fluent in every situation', 'I no longer need listening practice'], 'Describe the specific supported tasks you can do and the practice you still need.'),
  ],
];

function buildQuiz(items, lessonIndex) {
  return { version: 1, passScore: 3, questions: items.map((item, index) => {
    const shift = (lessonIndex + index) % item.options.length;
    const options = item.options.map((_, position) => ({ id: String(position), text: item.options[(position + shift) % item.options.length] }));
    return { id: `q${index + 1}`, prompt: item.prompt, options, correctOptionId: String((item.options.length - shift) % item.options.length), explanation: item.explanation };
  }) };
}
export const courseQuizzes = Object.fromEntries(Object.entries({ python, 'ai-literacy': ai, spanish }).map(([id, lessons]) => [id, Object.fromEntries(lessons.map((items, index) => [`week-${Math.floor(index / 2) + 1}-task-${index % 2 + 1}`, buildQuiz(items, index)]))]));

const assignment = (title, prompt, deliverables, checklist, discussion) => ({ version: 1, title, prompt, deliverables, checklist: checklist.map((text, index) => ({ id: `c${index + 1}`, text })), discussion });
export const courseAssignments = {
  python: [
    assignment('Build a small habit list', 'Combine the first two lessons into one script that collects and displays at least two habits. Work locally in your editor, then paste your code and a short run log here, or link to your project.', ['Your script with input, trimming, a list and numbered output.', 'A run with ordinary names, one with surrounding spaces, and one blank input.', 'Two sentences explaining where the data lives before file saving is added.'], ['Blank names are rejected without a traceback.', 'At least two accepted habits appear in their original order.', 'I ran the three input cases and recorded the actual output.'], 'Compare one input case with your squad. Explain why a list disappears on restart.'),
    assignment('Make the tracker interactive', 'Extend your own tracker with an add/list/done/quit menu, stable habit IDs and completion dates. Reuse and improve your first-week work.', ['Code or a project link, plus a short menu walkthrough.', 'A test that completes one habit twice on the same day.', 'A test for an unknown command and an unknown habit ID.'], ['The menu repeats until quit is chosen.', 'Only the selected habit is updated, and today is recorded once.', 'Invalid commands and IDs preserve the existing list.'], 'Ask a teammate to predict the data after two repeated completion commands, then compare with your run.'),
    assignment('Keep data between runs', 'Add JSON saving and loading to your tracker. Test recovery using a separate test file so you do not damage your working data.', ['Code or a project link and an add → close → restart run log.', 'Results for a missing file, malformed JSON and valid JSON with the wrong shape.', 'A note explaining how damaged data is preserved.'], ['A saved habit and its completion dates survive a restart.', 'A missing file starts a new empty tracker.', 'Damaged or invalid records produce a clear message without silently overwriting the original file.'], 'Compare recovery messages and discuss what the user should do next when a file is damaged.'),
    assignment('Deliver your habit tracker', 'Prepare a small final release another learner can run. Include your own test evidence and a concise guide; a pasted source plus guide is acceptable if you do not have hosting.', ['Runnable source or a project link and setup/run instructions.', 'A test table covering add, list, completion, restart and two invalid inputs.', 'One limitation and one realistic next improvement.'], ['I followed the guide from a fresh start and ran the main flow.', 'The test table records expected and actual outcomes.', 'The guide explains local storage and recovery without claiming automatic sync.'], 'Take turns demonstrating one normal case and one recovery case. Record one improvement suggested by the discussion.'),
  ],
  'ai-literacy': [
    assignment('Create and review a useful draft', 'Choose a fictional everyday task, such as a club invitation or project update. Write the facts, a reusable prompt and a reviewed draft. You may write the draft yourself; no AI account is required.', ['Source facts and a prompt naming the task, context, limits and format.', 'A first draft and your corrected version.', 'Three review checks and a note about one change you made.'], ['Every specific fact in the final draft comes from the source or is marked unknown.', 'The prompt has a clear output format and at least one constraint.', 'I used fictional or appropriate non-sensitive information.'], 'Let a teammate find one place where a draft could accidentally invent a commitment.'),
    assignment('Build a checked summary and claim log', 'Create a short fictional meeting note with a confirmed action, a suggestion and a missing detail. Summarize it, then check two claims against a source text you can read.', ['Original notes and a summary separating decisions, proposals and unknowns.', 'A two-row claim log: claim, source or passage, date/context, and verified/unsupported/uncertain outcome.', 'A corrected sentence for one unsupported or overstated claim.'], ['No owner, deadline or decision was invented to fill a gap.', 'Each claim outcome has a reason tied to its source.', 'I retained uncertainty where the evidence was incomplete.'], 'Exchange one claim with a teammate and explain which exact passage supports it.'),
    assignment('Improve a constrained planning prompt', 'Design a plan for a fictional 60-minute block. Include task durations and a buffer. Try the same prompt on three small input sets, improve one instruction and compare the results.', ['The time budget, tasks, durations and final feasible plan.', 'Original and revised prompts with the one instruction you changed.', 'A three-case comparison recording both improvements and remaining problems.'], ['The final durations and buffer fit within 60 minutes.', 'Both versions were compared using the same inputs and checks.', 'I documented a failure or limitation instead of reporting only successes.'], 'Show your squad the case that was hardest to plan. Check the arithmetic together.'),
    assignment('Publish your personal AI-use playbook', 'Assemble a compact workflow you would actually reuse. Include two worked examples from your course, human review steps and a way to finish the task without the tool.', ['The task, reusable prompt and two before-and-after examples.', 'A checklist covering input, factual review and the decision to use the result.', 'A manual fallback, a privacy limit and an unresolved limitation.'], ['Examples show what I reviewed and corrected.', 'A person checks the result before it is shared or acted on.', 'The workflow explains when the tool should not be used and what to do instead.'], 'Demonstrate one example and ask a teammate to apply your checklist. Note a clarification that would make it easier to reuse.'),
  ],
  spanish: [
    assignment('Introduce yourself in a short exchange', 'Write a 6–8-line dialogue introducing two people, their origins and one routine or interest. Read both roles aloud, then practise with your squad. Fictional names and details are welcome.', ['Your Spanish dialogue with a brief English meaning for each line.', 'At least two questions for the other speaker.', 'One phrase you used to ask for repetition or slower speech.'], ['The exchange includes a greeting, name, origin and polite closing.', 'Both people speak and ask or answer a question.', 'I read it aloud and noted one phrase I need to practise.'], 'Swap roles. Change one name or interest so you are responding rather than only reciting.'),
    assignment('Order and confirm a purchase', 'Write two short exchanges: ordering in a café and asking about items in a shop. Use a fictional menu with explicit prices so you can check every total.', ['A small menu or price list and two dialogues in Spanish.', 'One quantity and total-price calculation.', 'A clarification question and a request for the bill.'], ['Orders include a polite request.', 'The quantity and total match the price list.', 'At least one amount is repeated as a confirmation question.'], 'Let a teammate change the quantity. Recalculate and confirm the new total aloud.'),
    assignment('Give directions and arrange a meeting', 'Describe a simple fictional map with three places. Write a short route, then a dialogue agreeing on a day, time and meeting place.', ['A text map or map link with labelled places.', 'Two or three directions in Spanish that lead to the destination.', 'An invitation, a reply and a final confirmation of day, time and place.'], ['I followed the directions against my own map.', 'The final meeting details are explicit and consistent.', 'The dialogue includes a question to clarify a location or time.'], 'Ask a teammate to follow your route and repeat the meeting details. Correct any ambiguity together.'),
    assignment('Share a phrasebook and final dialogue', 'Build a phrasebook for situations you practised, then write and read an 8–12-line conversation combining two of them. Keep it short enough to understand every line.', ['A phrasebook with at least eight phrases grouped by situation and their meanings.', 'A final dialogue combining two situations.', 'Two communication skills you can now practise and one next learning goal.'], ['I can explain each phrase rather than only copy it.', 'The dialogue contains a repair or confirmation question.', 'I practised aloud and describe my current ability without claiming fluency.'], 'Perform the conversation with your squad. Change one detail and practise asking for clarification.'),
  ],
};

export function publicQuiz(quiz) {
  return { version: quiz.version, passScore: quiz.passScore, questions: quiz.questions.map(({ id, prompt, options }) => ({ id, prompt, options })) };
}

export function gradeQuiz(quiz, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== quiz.questions.length) return null;
  const feedback = [];
  for (const q of quiz.questions) {
    if (!Object.hasOwn(answers, q.id) || !q.options.some(option => option.id === answers[q.id])) return null;
    const correct = answers[q.id] === q.correctOptionId;
    feedback.push({ questionId: q.id, correct, explanation: q.explanation, correctOptionId: q.correctOptionId });
  }
  const score = feedback.filter(item => item.correct).length;
  return { score, total: quiz.questions.length, passed: score >= quiz.passScore, feedback };
}
