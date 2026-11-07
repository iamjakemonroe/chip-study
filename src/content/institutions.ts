/** What an institution's admins and teachers can and can't see of a student, said the same way
 * everywhere: before joining, on the institutions page, in settings and in the Privacy Policy.
 * It follows what the server lets them read (study_institution_students and _student). */

export const CAN_SEE = {
  you: [
    'Your name and email',
    'When you were last active, and your study time',
    'Your practice scores, and how often you ask Chip',
    'Your assignments’ titles, due dates and word counts',
    'Each assignment’s AI-use record: the kind of help, like “Asked Chip to explain”, and when',
  ],
  students: [
    'Who’s active, and their study time',
    'Practice scores, and how often they ask Chip',
    'Assignment titles, due dates and word counts',
    'Each assignment’s AI-use record: the kind of help, like “Asked Chip to explain”, and when',
  ],
};

export const CANT_SEE = {
  you: ['Your chats with Chip', 'Your notes and documents', 'Your sources and readings', 'The words of your questions or Chip’s answers'],
  students: ['Chats with Chip', 'Notes and documents', 'Sources and readings', 'The words of their questions or Chip’s answers'],
};
