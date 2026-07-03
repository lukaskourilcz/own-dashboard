type TugedrStrings = {
  title: string;
  description: string;
  // To-do card
  todosTitle: string;
  addTodoPlaceholder: string;
  addTodo: string;
  todosEmpty: string;
  clearDone: string;
  deleteTodo: string;
  remaining: (n: number) => string;
  // Ideas card
  ideasTitle: string;
  addIdeaPlaceholder: string;
  addIdea: string;
  ideasEmpty: string;
  deleteIdea: string;
};

export const tugedr: { en: TugedrStrings; cs: TugedrStrings } = {
  en: {
    title: "Tugedr",
    description: "A standalone to-do list and a place to park ideas.",
    todosTitle: "To-do list",
    addTodoPlaceholder: "Add a task…",
    addTodo: "Add",
    todosEmpty: "Nothing here yet — add your first task.",
    clearDone: "Clear done",
    deleteTodo: "Delete task",
    remaining: (n) => (n === 1 ? "1 left" : `${n} left`),
    ideasTitle: "Ideas",
    addIdeaPlaceholder: "Jot an idea…",
    addIdea: "Add",
    ideasEmpty: "No ideas yet — capture the first one.",
    deleteIdea: "Delete idea",
  },
  cs: {
    title: "Tugedr",
    description: "Samostatný seznam úkolů a místo na nápady.",
    todosTitle: "Seznam úkolů",
    addTodoPlaceholder: "Přidat úkol…",
    addTodo: "Přidat",
    todosEmpty: "Zatím tu nic není — přidej první úkol.",
    clearDone: "Smazat hotové",
    deleteTodo: "Smazat úkol",
    remaining: (n) => {
      if (n === 1) return "zbývá 1";
      if (n >= 2 && n <= 4) return `zbývají ${n}`;
      return `zbývá ${n}`;
    },
    ideasTitle: "Nápady",
    addIdeaPlaceholder: "Zapiš nápad…",
    addIdea: "Přidat",
    ideasEmpty: "Zatím žádné nápady — zachyť první.",
    deleteIdea: "Smazat nápad",
  },
};
