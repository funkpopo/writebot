declare const OfficeRuntime: {
  storage?: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
    onChanged?: {
      addListener?: (handler: (args: {
        changedItems?:
          | Array<{ key: string; newValue?: string }>
          | Record<string, { newValue?: string }>;
      }) => void) => void;
      removeListener?: (handler: (args: {
        changedItems?:
          | Array<{ key: string; newValue?: string }>
          | Record<string, { newValue?: string }>;
      }) => void) => void;
    };
  };
};
