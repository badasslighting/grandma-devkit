# Console behaviour: conditions and variables

What each console does with conditions and variables in command strings, macros and Lua, checked on onPC (grandMA2 3.9.61.1, grandMA3 2.5.1.0), and what the Devkit does about it. Part of the [Devkit README](../README.md).

## Conditional commands

What each console does with a condition in a command string (`Cmd("...")`, `gma.cmd("...")`), checked on onPC (grandMA2 3.9.61.1, grandMA3 2.5.1.0):

| | grandMA2 | grandMA3 |
| --- | --- | --- |
| `[$var==5] Off Page 3` | runs the rest of the line only if true; `==` `>` `<` `<=` `>=`; two numbers compare as numbers, anything else as case-sensitive text | never runs |
| `[$var=5]`, `[$var~=5]`, `[$var<>5]`, `[$var]` | never true, so the line never runs | never runs |
| `[$var!=5]` | **behaves like `==`**: runs when the two are equal | never runs |
| `[$a==1 && $b==2]`, `or`, `and`, `NOT`, `( )`, `$a+1` | only the first comparison counts; the rest is ignored or false (`||` is Error #3 on the command line) | never runs |
| `[$a==1] [$b==2] cmd` | only the last `[..]` counts | never runs |
| `[$a=="x]y"] cmd` | the `]` inside quotes still ends the condition | never runs |
| `[$a==1] cmd1 ; cmd2` | the condition covers the whole `;` chain | never runs |
| `$unset` in a condition | every comparison is false (and `$unset` elsewhere is Error #54) | the command does not run |
| `If` / `EndIf` / `IfOutput` / `IfActive` / `IfProg` | selection filters, not branches (`If $var==1 Go+` tests nothing) | same |
| Condition in Lua | `gma.show.getvar` returns **text** (`"7"`) or nil | `GetVar(UserVars(), "x")` returns a number or text, as stored |

The extension helps with this inside command strings:

- **Completion**: on grandMA2, `[condition]` at the start of a string, comparison operators and `]` inside an open condition, and keyword completion after the closed condition; `If`, `EndIf`, `IfOutput`, `IfActive` and `IfProg` on both consoles, with the objects they filter offered after `If`.
- **Hover**: the `If` family on both consoles; anything inside a grandMA2 `[condition]`.
- **Checks**: on grandMA3 a `[condition]` prefix (`bracket-ma3`, with a quick fix that rewrites a plain `Cmd("[$x==5] ...")` as a Lua `if`); on grandMA2 an unclosed or empty condition, a missing command, an unsupported operator, a missing operator, `!=` (it means `==`), `&&` / `||` / `and` / `or` (ignored), `NOT` and brackets and arithmetic, stacked `[..]` brackets, a `]` inside quotes; on both an `If` followed by a comparison (`if-not-branch`) and an `EndIf` with no `If`; on grandMA2 `gma.show.getvar(...)` compared with a number (`getvar-number`, quick fix wraps it in `tonumber`).
- Snippets: `ma3if`, `ma2if` (Lua conditions around `Cmd` / `gma.cmd`) and `ma2cond` (a `[condition]` command line).

## Variables

How each console handles a variable, checked on onPC (grandMA2 3.9.61.1, grandMA3 2.5.1.0):

| | grandMA2 | grandMA3 |
| --- | --- | --- |
| Set in a command | `SetVar $x = 7` (global), `SetUserVar $x = 7` (per user) | `SetGlobalVariable "x" 7`, `SetUserVariable "x" 7` |
| Set in Lua | `gma.show.setvar('x', v)` (global), `gma.user.setvar('x', v)` | `SetVar(GlobalVars(), 'x', v)`, `SetVar(UserVars(), 'x', v)`, also `PluginVars()` and `AddonVars()` |
| Read in Lua | `gma.show.getvar('x')`, `gma.user.getvar('x')`: always **text**, no `$`, each sees only its own scope | `GetVar(UserVars(), 'x')`: a number or text as stored |
| Remove | `SetVar $x =` (`SetUserVar $x =`); `DelVar` does nothing | `DelVar(UserVars(), 'x')` |
| Names | case-insensitive | **case-sensitive** |
| In a command or macro line | `$x` outside quotes, also inside a number (`Preset 4.$n`), after text (`24$n`, `$a$b`) and in a range (`Macro $a Thru $b`) | outside quotes, after text and in a range (a dotted number such as `4.$n` was not checked) |
| Inside "quotes" | not expanded; a name with `$` is an illegal name | not expanded; the `$` is dropped (`"x$a"` becomes `"xa"`) |
| Unset `$x` | Error #54, the command does not run | the command does not run |
| A user and a global variable with one name | the user one is read | the user one is read |
| A value that is a command word or its short form (`G`, `Go`, `COL`) | not stored unless quoted | stored when quoted, but expanded into a command it is read as a command word, so the command fails; a `Label` that gets one opens the rename dialog, which freezes the console's Lua until it is closed |
| System variables | 26 (`$FADERPAGE`, `$SELECTEDEXEC`, `$VERSION`, `$USER`, ...), listed by `ListVar` | none found |
| List them | `ListVar` over Telnet (user variables belong to the Telnet user) | cannot be listed: `Count()` is 0 and there are no children |
| A value written without quotes | a command word, several words or a `]` is not stored (`SetVar $k = Macro`); quote text values | read as part of a command; quote text values |
| `;` chain | every `$x` is replaced before the chain runs, so `SetVar $b = 1 ; Go+ $b` uses the old value | not checked |

What the extension does with them, in Lua `Cmd()` / `gma.cmd()` strings, `.gma2macro` and `.gma3macro` files and exported macro XML:

- **Index** of every definition and use across the workspace (the `grandMA Variables` features below all read it). Two consoles stay apart; grandMA3 names match case-exactly.
- **Checks**: `var-undefined` (set nowhere in the workspace), `var-in-quotes`, `var-value-unquoted`, `var-chain`, `var-case` (grandMA3), `var-scope` (`gma.show.getvar` on a user variable and the reverse), `var-dollar-in-api` (`gma.show.getvar('$x')` reads nothing), `var-shadow` (one name as user and global). Quick fixes where there is a single right answer.
- **Completion** of `$name` (workspace names, grandMA2 system variables, and what the console holds after a read), of the name inside `GetVar` / `SetVar` / `DelVar` / `gma.show.getvar` strings and `SetUserVariable "`; in macro files also command words and `[condition]`.
- **Hover** on a variable (where it is set, its value, uses, the console's current value), inside a macro `[condition]`, and on the `If` family. **Go to Definition**, **Find References**, **Highlight** and **Rename Symbol** (F2) work across Lua, macro and XML files; a rename onto an existing name is refused.
- **Replace Variables Across a Range** (`grandMA: Replace Variables Across a Range`): give `$color1 thru $color5` (or `color1..color5`, `$c01 - $c05`) and a template such as `$hue{n}`, `hue{n+10}` or `hue{n:3}`, and pick selection, file or the whole workspace. Every form of each variable changes: `$color1`, `'color1'` in Lua calls, `SetUserVariable "color1"`, XML-escaped macro lines.
- **Preview What This Command Line Runs**: the line with its variables replaced and, on grandMA2, whether its `[condition]` is true (values from the workspace and the last console reading).
- **Replace Variable With Its Value**, **Extract Selection to a Variable**, and **Convert Variables and Conditions to the Other Console**, which opens the other console's version beside the file (`SetVar $x = 7` and `SetGlobalVariable "x" 7`, `gma.show.getvar` and `GetVar(GlobalVars(), ...)`, `[$x==5] cmd` and a Lua `if`).
- **Console Variables** view (Explorer): grandMA2 lists everything (`ListVar` over Telnet), grandMA3 shows the names the workspace knows with their live values. Set, add, delete, copy a name; **Watch Console Variables** prints changes as they happen; **Snapshot**, **Compare With Snapshot** and **Restore From Snapshot** (it never touches system variables).
- **Variable Bank** view (Explorer): **Favorites** (your own list, kept in VS Code's global storage so it follows you between workspaces, and through Settings Sync when that is on), **In use** (every variable the files in the workspace mention, most used first, with uses, sets and files; click one to jump to where it is set) and **Stock** (the 26 grandMA2 system variables with a line on each; grandMA3 has none that a command or `GetVar` resolves). Star a variable from the view or from the cursor (**Add Variable to Favorites**), give a favorite a value and a note (**Edit Favorite Variable**), **Insert Variable** puts one at the cursor (favorites, then most used first), **Set Favorite Variables on the Console** applies the ones that have a value, and **Export / Import Favorite Variables** move the list as a JSON file. Completion of `$name` is ordered the same way: favorites, then most used.
- Lua tests: `withVars({ user = { x = 7 }, global = { y = 'a' } }, function() ... end)` sets variables for the function and puts every one back afterwards, also when it fails.
