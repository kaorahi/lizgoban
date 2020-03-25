The following descriptions are obsolete. Though they may still work partially, they will be deleted in future without warnings.

#### To enable endstate estimation (experimental, may be deleted in future):

This is based on [endstate_head branch by ihavnoid](https://github.com/leela-zero/leela-zero/issues/2331).

1. Build [a modified leelaz](https://github.com/kaorahi/leela-zero/tree/endstate_map) and rename "leelaz" to "leelaz_endstate".
2. Download [the weight file](https://drive.google.com/open?id=1ZotPAUG0zz-y7K-e934AHyYF8_StWmyN) and rename it to "network_endstate.gz".
3. Start LizGoban as `npm start -- -c config.json` with the file config.json:

~~~~
{
    "endstate_leelaz": ["/foo/bar/leelaz_endstate",
                        ["-g", "-w", "/foo/bar/network_endstate.gz"]],
    ...
}
~~~~

(Sorry for the ugly second brackets `[]` for backward compatibility.)
It is ignored when you are using KataGo, that gives more reliable estimations.

#### To attach LizGoban to [Sabaki](https://sabaki.yichuanshen.de/) as subwindows (obsolete, may be deleted in future):

1. Build a [customized Sabaki](https://github.com/kaorahi/Sabaki/tree/dump_state2) in "dump_state2" branch.
2. Put Sabaki binary as "external/sabaki".
3. Start LizGoban.
4. Click "Attach Sabaki" in "Tool" menu of LizGoban and wait for Sabaki window.
5. Put a stone on Sabaki and see it appears on LizGoban.
