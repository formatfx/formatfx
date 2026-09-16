declare interface IFormatFxCommandSetStrings {
  Command1: string;
  Command2: string;
}

declare module 'FormatFxCommandSetStrings' {
  const strings: IFormatFxCommandSetStrings;
  export = strings;
}
