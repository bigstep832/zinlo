// Original English explanations and Spanish practice dialogues for this course.
const section = (title, paragraphs, example) => ({ title, paragraphs, ...(example ? { example, exampleLanguage: 'text' } : {}) });
const check = (question, answer, explanation) => ({ question, answer, explanation });

export const spanishLessons = [
  {
    objectives: ['Introduce yourself and ask for a name and country.', 'Say short phrases slowly with clear vowel sounds.'],
    sections: [
      section('Start with useful exchanges', [
        'Hola means hello and works in many situations. Buenos días is good morning; buenas tardes is good afternoon; buenas noches can be an evening greeting or a goodbye at night. Use gracias for thank you and por favor for please. Learn these as complete phrases before analysing every word.',
        'Me llamo Ana means my name is Ana. Ask ¿Cómo te llamas? when talking informally to one person, such as a teammate. After their answer, mucho gusto means nice to meet you. Spanish questions have an opening ¿ and a closing ?. The opening mark helps you recognise the question before reading it aloud.',
      ]),
      section('Share where you are from', [
        'Soy de Canadá means I am from Canada. Soy is the I form of ser, used here to identify your origin. Ask ¿De dónde eres? and return a question with ¿Y tú? — and you? You do not need to add yo before soy: the verb already identifies the speaker. Invented names and countries are fine for practice.',
        'Copy the accents in cómo, dónde, Canadá and México. An accent mark is part of the word, not decoration. Your first goal is to understand and exchange the chosen information. Pausing or looking at notes is welcome; a fast memorised performance is less useful than an exchange you understand.',
      ], 'A: Hola, me llamo Ana. ¿Cómo te llamas?\nB: Me llamo Alex. Mucho gusto.\nA: ¿De dónde eres?\nB: Soy de Canadá. ¿Y tú?\nA: Soy de México. Hasta luego.\n\nHasta luego = See you later.'),
      section('Make the sounds manageable', [
        'Spanish has five basic vowel sounds. As rough English starting points: a is ah, e is eh, i is ee, o is a steady oh, and u is oo. Keep them short and steady instead of sliding between sounds. Practise Ana, mesa, sí, no and tú. These hints are approximate; they are not an exact English spelling system for Spanish.',
        'The h in hola is silent. Many speakers pronounce ll in llamo like the y in yes; regional pronunciations differ. A written accent points to the stressed syllable: ca-na-DÁ. Without an accent, a common starting rule is stress on the next-to-last syllable for words ending in a vowel, n or s, and the last for other endings. Say HO-la and pa-PEL; learn exceptions as you meet them.',
      ]),
    ],
    exercise: {
      prompt: 'Write and speak a six-line introduction with a partner. Change both names and countries, ask both questions, then repeat without reading the English meanings.',
      checklist: ['Both people give a name and origin.', 'Both ask a question instead of only reading answers.', 'You can explain every phrase you use.'],
      sampleAnswer: 'A: Hola, me llamo Leo. ¿Cómo te llamas?\nB: Me llamo Maya. Mucho gusto.\nA: ¿De dónde eres?\nB: Soy de Estados Unidos. ¿Y tú?\nA: Soy de Canadá.\nB: Hasta luego.\n\nEstados Unidos = the United States. Change these fictional details for your own practice.',
    },
    checks: [check('How do you ask someone’s name in this informal exchange?', '¿Cómo te llamas?', 'Me llamo… gives your own name; ¿Cómo te llamas? asks for the other person’s.'), check('Does Soy de México describe your location right now?', 'No. It describes where you are from.', 'Origin and current location are different meanings. You will use está for the location of a place later.')],
    recap: ['Use a short exchange you understand.', 'Ask, listen and return a question; keep notes available.'],
  },
  {
    objectives: ['Describe a simple routine and an interest.', 'Ask for repetition when a phrase is unclear.'],
    sections: [
      section('Build a small set of true statements', [
        'Trabajo means I work; estudio means I study. Add a short detail: trabajo por la mañana — I work in the morning; estudio por la noche — I study at night. Por la tarde means in the afternoon or evening. These are useful chunks; you do not need to translate each English preposition separately.',
        'In these regular -ar verbs, the I form ends in -o and the informal you form ends in -as: trabajo/trabajas and estudio/estudias. You can ask ¿Trabajas por la mañana? with a question intonation and answer sí or no. To make a statement negative, put no before the verb: no trabajo por la noche.',
      ], 'A: Trabajo por la mañana. ¿Y tú?\nB: Estudio por la tarde. No trabajo por la noche.\n\npor la mañana = in the morning\npor la tarde = in the afternoon/evening\npor la noche = at night'),
      section('Talk about an activity you like', [
        'Use me gusta plus an activity in its dictionary form: me gusta leer — I like reading; me gusta cocinar — I like cooking; me gusta caminar — I like walking. The activity stays leer, cocinar or caminar after me gusta. Do not change it to leo, cocino or camino in this pattern.',
        'Ask ¿Qué te gusta hacer? — what do you like doing? A short answer is enough: me gusta leer. ¿Y a ti? returns the same question. For something you dislike, say no me gusta…. For now, practise activity phrases; liking several objects uses a different pattern that you can learn later.',
      ], 'A: ¿Qué te gusta hacer?\nB: Me gusta cocinar. ¿Y a ti?\nA: Me gusta leer.\n\n¿Qué…? = What…?\nhacer = to do'),
      section('Keep the conversation going when you miss something', [
        'No entiendo means I do not understand. ¿Puedes repetir, por favor? means can you repeat, please? Más despacio, por favor asks for a slower pace. These are conversation skills, not signs of failure. Choose the specific repair you need instead of nodding when the meaning is unclear.',
        'Practise in two passes. First use written prompts, then hide one line and let the speaker choose an interest. The listener repeats the key activity to confirm it. Change just one detail at a time so you practise listening without making the whole exchange unfamiliar.',
      ]),
    ],
    exercise: {
      prompt: 'Say when you work or study and name an activity you like. Ask your partner about their routine and interest. Deliberately practise asking them to repeat one answer.',
      checklist: ['You make two short routine statements, including one negative if useful.', 'You use me gusta with an activity.', 'You request repetition and confirm what you heard.'],
      sampleAnswer: 'A: Estudio por la noche. No trabajo por la mañana. ¿Qué te gusta hacer?\nB: Me gusta caminar.\nA: ¿Puedes repetir, por favor?\nB: Me gusta caminar.\nA: ¿Caminar?\nB: Sí. ¿Y a ti?\nA: Me gusta cocinar.',
    },
    checks: [check('Which fits this pattern: me gusta leer or me gusta leo?', 'Me gusta leer.', 'Leer names the activity; leo is a conjugated form meaning I read.'), check('Where does no go in “I do not work at night”?', 'No trabajo por la noche.', 'Put no directly before the verb trabajo.')],
    recap: ['Learn small patterns you can change.', 'Asking for repetition is part of a successful exchange.'],
  },
  {
    objectives: ['Order two items politely and answer a follow-up question.', 'Ask for the bill using a short supported exchange.'],
    sections: [
      section('Learn the item together with its article', [
        'Practise un café — a coffee, un té — a tea, un bocadillo — a sandwich, and una tostada — a piece of toast. Un and una both mean a/an here; Spanish nouns have grammatical gender, so learn the article with the noun. Do not assume that every noun follows an English meaning or a single spelling rule.',
        'Un café con leche is a coffee with milk. A simple water order is un vaso de agua — a glass of water. To ask whether something is available, use ¿Hay té? — is there tea? Hay is useful for asking whether something exists or is available; it is different from asking where a particular item is.',
      ]),
      section('Make the request and listen for the response', [
        'Quisiera un café, por favor means I would like a coffee, please. Learn quisiera as a polite request chunk for now; you do not need its full grammar to use this exchange. Para mí, un té, por favor — for me, a tea, please — is another useful option.',
        '¿Algo más? means anything else? Answer sí, una tostada, por favor or no, gracias. ¿Para aquí o para llevar? asks whether the order is for here or to take away. The short answers para aquí and para llevar carry the needed meaning. Different cafés use different wording, so ask for repetition when necessary.',
      ], 'A: Hola. Quisiera un café con leche y una tostada, por favor.\nB: ¿Algo más?\nA: No, gracias.\nB: ¿Para aquí o para llevar?\nA: Para aquí.\n\ny = and; con = with; para aquí = for here'),
      section('Finish the exchange clearly', [
        'La cuenta, por favor means the bill, please. If you need to check the total, ask ¿Cuánto es? — how much is it? Do not pretend you understood a number. You can ask ¿Puedes repetir, por favor? with a teammate, or use the more formal ¿Puede repetir, por favor? with someone you are addressing formally.',
        'For practice, agree on a fictional menu before starting: coffee three euros, tea two euros and toast two euros. One partner chooses an order and the other serves it. Switch roles and change one item. The aim is to convey the order and understand the follow-up, not to reproduce a script word for word.',
      ]),
    ],
    exercise: {
      prompt: 'Use a fictional menu to order two items, answer “anything else?” and “for here or takeaway?”, then ask for the bill. Repeat with a different order.',
      checklist: ['Your request includes por favor and two clear items.', 'Your answer matches the follow-up question.', 'You close the exchange and clarify any uncertain detail.'],
      sampleAnswer: 'A: Hola. ¿Hay té?\nB: Sí.\nA: Quisiera un té y una tostada, por favor.\nB: ¿Para aquí o para llevar?\nA: Para llevar.\nB: ¿Algo más?\nA: No, gracias. La cuenta, por favor.\n\nMeaning: the customer checks for tea, orders tea and toast to take away, then asks for the bill.',
    },
    checks: [check('How could you politely ask for a coffee?', 'Quisiera un café, por favor.', 'Quisiera is the request frame, un café names the item, and por favor adds please.'), check('Does ¿Algo más? ask where you will drink it?', 'No. It asks whether you want anything else.', 'For here or takeaway is ¿Para aquí o para llevar?')],
    recap: ['Learn each item with its article.', 'A good order includes listening to the follow-up.'],
  },
  {
    objectives: ['Ask a price and request a small quantity.', 'Confirm a total instead of guessing what you heard.'],
    sections: [
      section('Use a small number range confidently', [
        'Start with numbers you can use immediately. Say them slowly, then let your partner choose a number for you to write down. Reading a list in order is different from recognising a number in conversation. Alternate between saying, hearing and writing.',
        'Uno is the number one by itself. Before a masculine item such as cuaderno, use un cuaderno; before a feminine item such as libreta, use una libreta. Dos works with either: dos cuadernos, dos libretas. These nouns make their plural with -s. Keep this practice to simple whole-number prices before adding decimals.',
      ], '0 cero · 1 uno · 2 dos · 3 tres · 4 cuatro · 5 cinco\n6 seis · 7 siete · 8 ocho · 9 nueve · 10 diez\n11 once · 12 doce · 13 trece · 14 catorce · 15 quince\n16 dieciséis · 17 diecisiete · 18 dieciocho · 19 diecinueve · 20 veinte\n\nun cuaderno = a notebook; una libreta = a small notebook'),
      section('Ask about one item or several', [
        '¿Cuánto cuesta un cuaderno? means how much does a notebook cost? The answer can be cuesta cinco euros — it costs five euros. For several items use ¿Cuánto cuestan dos cuadernos? and cuestan diez euros. Cuesta and cuestan change because the thing being priced is singular or plural.',
        'Request the quantity with quisiera dos cuadernos, por favor. Ask for the total using ¿Cuánto es en total? A unit price and a total are different pieces of information. In this fictional shop one notebook is five euros, so two cost ten euros; use the agreed practice price rather than inventing a discount.',
      ], 'A: ¿Cuánto cuesta un cuaderno?\nB: Cuesta cinco euros.\nA: Quisiera dos cuadernos, por favor. ¿Cuánto es en total?\nB: Diez euros.\nA: ¿Diez euros por los dos?\nB: Sí.\n\npor los dos = for both'),
      section('Confirm the number that matters', [
        'Repeat the amount as a question: ¿Diez euros? If you still cannot distinguish the number, ask ¿Puede escribirlo, por favor? — can you write it, please? You are checking meaning, not merely trying to sound fluent. A correct clarification is more useful than a confident guess.',
        'Practise with three cards showing an item, unit price and quantity. The listener should not see the price at first. After the dialogue, compare their written total with the card. Change the roles and the numbers; keep all practice amounts fictional.',
      ]),
    ],
    exercise: {
      prompt: 'Create two fictional shop exchanges: one notebook at five euros, then three notebooks at the same unit price. Ask the price, request the quantity and confirm the total.',
      checklist: ['You distinguish five per notebook from the total.', 'Use cuesta for one item and cuestan for several.', 'The final quantity and amount are confirmed aloud.'],
      sampleAnswer: 'A: ¿Cuánto cuesta un cuaderno?\nB: Cinco euros.\nA: Quisiera tres cuadernos. ¿Cuánto es en total?\nB: Quince euros.\nA: ¿Quince euros por los tres?\nB: Sí.\n\nFive euros × three notebooks = fifteen euros. For one notebook the total stays five.',
    },
    checks: [check('Which asks about two notebooks: cuesta or cuestan?', '¿Cuánto cuestan dos cuadernos?', 'Dos cuadernos is plural, so use cuestan.'), check('What can you say if you need to see the amount written?', '¿Puede escribirlo, por favor?', 'It requests a different way to clarify the same number, rather than guessing.')],
    recap: ['Check unit price, quantity and total separately.', 'Repeat or request a written number when needed.'],
  },
  {
    objectives: ['Ask where a place is and follow a short route.', 'Confirm the destination using a simple map.'],
    sections: [
      section('Ask about the location of a place', [
        '¿Dónde está el parque? means where is the park? Use está for the location of one place or object. This is different from soy de Canadá, which identifies a person’s origin. Do not try to choose between ser and estar by memorising “permanent versus temporary”; location and origin have different functions here.',
        'Learn a few destinations with their articles: el parque — park, el café — café, el supermercado — supermarket, la estación — station. Está cerca means it is nearby; está lejos means it is far away. Cerca de la estación means near the station. De + el becomes del: cerca del parque.',
      ], 'A: Perdona, ¿dónde está el café?\nB: Está cerca del parque.\nA: ¿Cerca del parque?\nB: Sí.\n\nPerdona = excuse me, informal. Perdone is a formal alternative.'),
      section('Follow two directions, then check', [
        'Useful route chunks are sigue recto — go straight, gira a la derecha — turn right, and gira a la izquierda — turn left. These forms address one person informally. The corresponding formal instructions are siga recto, gire a la derecha and gire a la izquierda. Practise one consistent set with your teammate.',
        'A la derecha and a la izquierda can also describe the destination: el café está a la derecha. En la esquina means on the corner. Listen for the action first, then the direction, then the place. You do not need a long route: two moves on a small map are enough to check understanding.',
      ], 'Fictional map route: start at the station, walk straight to the corner, turn right. The café is on your left.\n\nSigue recto hasta la esquina. Gira a la derecha. El café está a la izquierda.\n\nhasta la esquina = as far as the corner'),
      section('Use the map as feedback', [
        'Draw the station, one corner, the café and park before speaking. Both partners need the same map. One gives the route while the other traces it. The tracing makes misunderstandings visible; you can repair a left/right confusion instead of continuing with the wrong destination.',
        'Say ¿A la derecha? to confirm a direction or ¿Puedes repetir, por favor? to request the instruction again. Finish by pointing to the destination and asking ¿Aquí? — here? Success means arriving at the intended place, not saying every line without a pause.',
      ]),
    ],
    exercise: {
      prompt: 'Create a four-place imaginary map. Ask for a destination, follow two or three directions, then confirm the destination. Switch roles and change the start point.',
      checklist: ['The map and spoken route agree.', 'The listener clarifies at least one instruction.', 'Both agree on the final location.'],
      sampleAnswer: 'A: Perdona, ¿dónde está el café?\nB: Sigue recto hasta la esquina y gira a la derecha.\nA: ¿A la derecha?\nB: Sí. El café está a la izquierda.\nA: ¿Aquí?\nB: Sí, aquí.\n\nTrace the straight segment and right turn on your own map before checking where the café is.',
    },
    checks: [check('Choose the location question: “¿Dónde está el parque?” or “¿De dónde eres?”', '¿Dónde está el parque?', '¿De dónde eres? asks a person about their origin.'), check('What does gira a la izquierda ask you to do?', 'Turn left.', 'Gira is the action; a la izquierda supplies the direction.')],
    recap: ['Learn locations and directions as short patterns.', 'Check understanding against a shared map.'],
  },
  {
    objectives: ['Invite someone and suggest an alternative.', 'Agree on an activity, day, time and meeting place.'],
    sections: [
      section('Suggest one manageable plan', [
        '¿Quieres tomar un café? means would you like to have a coffee? Here quieres asks what the other person wants, and tomar names the activity. Other useful suggestions are ¿Quieres caminar? — would you like to walk? — and ¿Quieres ir al parque? — would you like to go to the park? A + el becomes al.',
        'Accept with sí, buena idea — yes, good idea. If you are unavailable, say no puedo el martes — I cannot on Tuesday. Follow with an alternative: ¿El jueves? You do not need to explain personal circumstances. The goal is to reach a plan both people understand.',
      ]),
      section('Make the day and time explicit', [
        'Days are lunes, martes, miércoles, jueves, viernes, sábado and domingo. Spanish normally writes them with a lowercase initial. El martes means on Tuesday for this arrangement; los martes means on Tuesdays as a recurring routine. Agree on the actual date in your practice notes when the week could be ambiguous.',
        'Ask ¿A qué hora? — at what time? Use a la una for one o’clock and a las dos, a las tres, and so on for later hours. A las cuatro y media means at half past four. Add de la mañana, de la tarde or de la noche when needed. Compare this clock phrase with por la mañana for a general routine.',
      ], 'A: ¿Quieres tomar un café el martes?\nB: No puedo el martes. ¿El jueves?\nA: Sí. ¿A qué hora?\nB: A las cuatro y media de la tarde.\n\nThursday at 4:30 p.m. — write the chosen practice date beside it.'),
      section('Close with a shared summary', [
        '¿Dónde quedamos? asks where shall we meet? En el café means at the café; delante del café means in front of the café. Delante distinguishes meeting outside from meeting somewhere inside. Repeat the day, time and place together before ending: el jueves, a las cuatro y media, delante del café.',
        'A conversation can contain several suggestions. Only the accepted details form the agreement. Listen for a correction such as no, a las cinco — no, at five. Update your written note, repeat the final version and let your partner confirm it. Do not keep the first proposed time after agreeing on another.',
      ]),
    ],
    exercise: {
      prompt: 'Arrange a fictional coffee meeting. Reject the first suggested day, agree on another, choose a time and place, then each write the final plan independently.',
      checklist: ['Both speakers suggest or clarify a detail.', 'The final notes agree on activity, day, time and place.', 'You distinguish the rejected proposal from the accepted plan.'],
      sampleAnswer: 'A: ¿Quieres tomar un café el martes?\nB: No puedo. ¿El jueves?\nA: Sí. ¿A la una?\nB: Mejor a las dos de la tarde.\nA: Bien. ¿Dónde quedamos?\nB: Delante del café.\nA: Entonces, el jueves a las dos de la tarde, delante del café.\nB: Perfecto.\n\nMejor = better; entonces = so/then. The accepted time is 2:00 p.m.',
    },
    checks: [check('Which is correct for one o’clock: a la una or a las una?', 'A la una.', 'One uses singular la; other hour numbers use las.'), check('Does el martes mean the same as los martes in this context?', 'No: el martes is the chosen Tuesday; los martes describes Tuesdays as a routine.', 'This distinction helps avoid confusing one arrangement with a recurring meeting.')],
    recap: ['Offer an alternative when the first plan does not work.', 'Repeat the accepted details before ending.'],
  },
  {
    objectives: ['Connect two familiar situations without relying on a fixed script.', 'Recover when a word or detail is unclear.'],
    sections: [
      section('Link chunks you already understand', [
        'A conversation does not need to be a long paragraph. It is a sequence of turns with a purpose: greet, ask, answer, clarify and close. Combine two situations from earlier lessons, such as meeting a friend and ordering a drink, or asking for directions and arranging a meeting.',
        'Use y — and — to add a compatible idea: un café y una tostada. Use pero — but — for a contrast: quiero un café, pero no puedo ahora. Quiero means I want; compare quieres, you want, from the invitation lesson. Ahora means now. Keep the rest in separate short sentences: familiar phrases are more useful than a complicated translation you cannot explain.',
      ]),
      section('Prepare repair phrases, not every possible answer', [
        '¿Qué significa…? asks what a word means. ¿Cómo se dice… en español? asks how to say something in Spanish. You can quote an English word while asking; the question is still useful practice. No entiendo, más despacio, por favor and ¿puedes repetir? remain available throughout the exchange.',
        'If you hear a changed detail, acknowledge the correction and repeat the new version. For example, your partner changes a meeting from four to five: ¿A las cinco? A successful repair ends with shared understanding. Simply saying sí to an unclear answer leaves the original problem unsolved.',
      ], 'A: ¿Quieres tomar un café el jueves a las cuatro?\nB: Sí, pero mejor a las cinco.\nA: ¿A las cinco?\nB: Sí.\nA: Perfecto. ¿Dónde está el café?\nB: Cerca del parque.\nA: No entiendo “cerca”. ¿Qué significa?\nB: “Near.”\nA: Gracias. Entonces, el jueves a las cinco, en el café.',
      ),
      section('Practise listening rather than memorising', [
        'Write role cards with different information, not a complete dialogue. One person knows the café location; the other chooses a meeting time. Take turns revealing only what the partner asks. Keep a phrasebook open, but respond to the answer you actually receive.',
        'After the first attempt, change one detail without changing the situation. Check whether the listener notices. Give feedback about meaning: “we agreed on different times” is useful, whereas “sound more fluent” is too vague. Choose one phrase to improve and repeat the exchange once.',
      ]),
    ],
    exercise: {
      prompt: 'Create a short exchange combining two previous situations. Include one changed detail and one genuine request for clarification. Write a note about what the clarification resolved.',
      checklist: ['The two situations connect naturally.', 'Both people contribute information.', 'A misunderstanding is repaired rather than ignored.'],
      sampleAnswer: 'Situation: invite a friend to a café, then ask where it is.\nChanged detail: the friend proposes five instead of four.\nClarification: ¿A las cinco? confirms the new time.\nVocabulary repair: ¿Qué significa “cerca”? resolves the location phrase.\nFinal shared plan: Thursday at five, inside the café near the park.\nNext attempt: keep the structure but change the day and location.',
    },
    checks: [check('What does the question “¿Qué significa…?” ask?', 'It asks what a word or expression means.', 'It helps repair meaning without abandoning the exchange.'), check('Why change one detail on the second attempt?', 'To check listening and flexible use of the phrases.', 'Repeating an unchanged script can hide whether the speaker understood the answer.')],
    recap: ['Connect familiar situations with short clear turns.', 'Understanding and repair matter more than speed.'],
  },
  {
    objectives: ['Build a usable personal phrasebook.', 'Demonstrate a supported exchange and choose the next learning goal.'],
    sections: [
      section('Turn notes into a tool you can use', [
        'Select at least twenty phrases from this sprint. Group them by purpose: introductions, routine and interests, café and shopping, directions, arranging plans, and repair phrases. Put Spanish, English meaning and one changeable detail side by side. A small organised reference is easier to use than an unstructured list of every word you encountered.',
        'For example, ¿Cuánto cuesta un cuaderno? becomes a price-question pattern with cuaderno as the changeable item. Keep grammatical connections visible: changing to two notebooks also changes cuesta to cuestan. Do not replace words randomly and assume the rest of the sentence always stays the same.',
      ], 'Purpose | Spanish | Meaning | Change carefully\nIntroduction | Me llamo Ana. | My name is Ana. | Name\nInterest | Me gusta leer. | I like reading. | Activity in its dictionary form\nPrice | ¿Cuánto cuesta un cuaderno? | How much is a notebook? | Item and singular/plural agreement\nPlan | A la una. | At one o’clock. | Use a las with other hours\nRepair | ¿Puedes repetir, por favor? | Can you repeat, please? | Puedes → puede for formal address'),
      section('Check meaning before polishing presentation', [
        'Read each entry and use it in a tiny exchange. Can you understand a likely answer? A phrasebook that only helps you ask questions is incomplete. Pair ¿Cómo te llamas? with me llamo… and ¿A qué hora? with a la una/a las dos. Include ways to ask for repetition when an answer goes beyond your current knowledge.',
        'Check articles, question marks, accents and the meaning you intend. Use the examples in this course or a trusted reference for unfamiliar additions. If you cannot verify a new phrase, mark it as a question for further study rather than teaching it to your partner as certain. Keep the reference readable instead of spending the practice time decorating it.',
      ]),
      section('Demonstrate what you can do with support', [
        'Choose two familiar situations and hold a short exchange of roughly two to three minutes, with pauses and notes allowed. Your partner should change one detail so you can show listening and repair. The duration is a guide, not a speed test; reaching an understandable agreement matters more.',
        'Reflect using evidence: “I confirmed the corrected time but needed help with the price” identifies a useful next step. Four weeks of practice does not establish fluency or certify a language level. Select one next goal, such as recognising numbers up to fifty or ordering without reading the prompt, and plan a small repeatable practice session.',
      ]),
    ],
    exercise: {
      prompt: 'Share your twenty-phrase reference and complete a supported exchange with a teammate. Afterwards, record one independent success, one moment requiring help and one specific next practice goal.',
      checklist: ['At least twenty phrases have checked meanings and a useful organisation.', 'The exchange includes listening, a changed detail and a clarification.', 'Your reflection describes observed behaviour instead of claiming fluency.'],
      sampleAnswer: 'Result: I used my phrasebook to arrange a café meeting and order tea.\nIndependent success: I corrected “a las una” to “a la una”.\nHelp needed: I asked my partner to repeat quince before confirming the price.\nNext goal: recognise five random prices from one to twenty without reading.\nPractice plan: two five-minute number exchanges this week, then repeat the café scene with one changed order.',
    },
    checks: [check('What should accompany a question in your phrasebook?', 'A likely answer pattern and, when useful, a way to ask for clarification.', 'Conversation requires understanding responses, not only producing questions.'), check('Which is a concrete next goal: “be fluent” or “recognise five spoken prices from one to twenty”?', 'Recognise five spoken prices from one to twenty.', 'It is small enough to practise and gives you an observable way to check improvement.')],
    recap: ['Keep a reference that helps real exchanges.', 'Use what happened in practice to choose your next step.'],
  },
];
