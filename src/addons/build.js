/*!
 * XRegExp.build 4.1.0
 * <xregexp.com>
 * Steven Levithan (c) 2012-present MIT License
 */

export default (XRegExp) => {
    const REGEX_DATA = 'xregexp';
    const subParts = /(\()(?!\?)|\\([1-9]\d*)|\\[\s\S]|\[(?:[^\\\]]|\\[\s\S])*\]/g;
    const parts = XRegExp.union([/\({{([\w$]+)}}\)|{{([\w$]+)}}/, subParts], 'g', {
        conjunction: 'or'
    });

    /**
     * Strips a leading `^` and trailing unescaped `$`, if both are present.
     *
     * @private
     * @param {String} pattern Pattern to process.
     * @returns {String} Pattern with edge anchors removed.
     */
    function deanchor(pattern) {
        // Allow any number of empty noncapturing groups before/after anchors, because regexes
        // built/generated by XRegExp sometimes include them
        const leadingAnchor = /^(?:\(\?:\))*\^/;
        const trailingAnchor = /\$(?:\(\?:\))*$/;

        if (
            leadingAnchor.test(pattern) &&
            trailingAnchor.test(pattern) &&
            // Ensure that the trailing `$` isn't escaped
            trailingAnchor.test(pattern.replace(/\\[\s\S]/g, ''))
        ) {
            return pattern.replace(leadingAnchor, '').replace(trailingAnchor, '');
        }

        return pattern;
    }

    /**
     * Converts the provided value to an XRegExp. Native RegExp flags are not preserved.
     *
     * @private
     * @param {String|RegExp} value Value to convert.
     * @param {Boolean} [addFlagX] Whether to apply the `x` flag in cases when `value` is not
     *   already a regex generated by XRegExp
     * @returns {RegExp} XRegExp object with XRegExp syntax applied.
     */
    function asXRegExp(value, addFlagX) {
        const flags = addFlagX ? 'x' : '';
        return XRegExp.isRegExp(value) ?
            (value[REGEX_DATA] && value[REGEX_DATA].captureNames ?
                // Don't recompile, to preserve capture names
                value :
                // Recompile as XRegExp
                XRegExp(value.source, flags)
            ) :
            // Compile string as XRegExp
            XRegExp(value, flags);
    }

    function interpolate(substitution) {
        return substitution instanceof RegExp ? substitution : XRegExp.escape(substitution);
    }

    function reduceToSubpatternsObject(subpatterns, interpolated, subpatternIndex) {
        subpatterns[`subpattern${subpatternIndex}`] = interpolated;
        return subpatterns;
    }

    function embedSubpatternAfter(raw, subpatternIndex, rawLiterals) {
        const hasSubpattern = subpatternIndex < rawLiterals.length - 1;
        return raw + (hasSubpattern ? `{{subpattern${subpatternIndex}}}` : '');
    }

    /**
     * Provides tagged template literals that create regexes with XRegExp syntax and flags. The
     * provided pattern is handled as a raw string, so backslashes don't need to be escaped.
     *
     * Interpolation of strings and regexes shares the features of `XRegExp.build`. Interpolated
     * patterns are treated as atomic units when quantified, interpolated strings have their special
     * characters escaped, a leading `^` and trailing unescaped `$` are stripped from interpolated
     * regexes if both are present, and any backreferences within an interpolated regex are
     * rewritten to work within the overall pattern.
     *
     * @memberOf XRegExp
     * @param {String} [flags] Any combination of XRegExp flags.
     * @returns {Function} Handler for template literals that construct regexes with XRegExp syntax.
     * @example
     *
     * const h12 = /1[0-2]|0?[1-9]/;
     * const h24 = /2[0-3]|[01][0-9]/;
     * const hours = XRegExp.tag('x')`${h12} : | ${h24}`;
     * const minutes = /^[0-5][0-9]$/;
     * // Note that explicitly naming the 'minutes' group is required for named backreferences
     * const time = XRegExp.tag('x')`^ ${hours} (?<minutes>${minutes}) $`;
     * time.test('10:59'); // -> true
     * XRegExp.exec('10:59', time).minutes; // -> '59'
     */
    XRegExp.tag = (flags) => (literals, ...substitutions) => {
        const subpatterns = substitutions.map(interpolate).reduce(reduceToSubpatternsObject, {});
        const pattern = literals.raw.map(embedSubpatternAfter).join('');
        return XRegExp.build(pattern, subpatterns, flags);
    };

    /**
     * Builds regexes using named subpatterns, for readability and pattern reuse. Backreferences in
     * the outer pattern and provided subpatterns are automatically renumbered to work correctly.
     * Native flags used by provided subpatterns are ignored in favor of the `flags` argument.
     *
     * @memberOf XRegExp
     * @param {String} pattern XRegExp pattern using `{{name}}` for embedded subpatterns. Allows
     *   `({{name}})` as shorthand for `(?<name>{{name}})`. Patterns cannot be embedded within
     *   character classes.
     * @param {Object} subs Lookup object for named subpatterns. Values can be strings or regexes. A
     *   leading `^` and trailing unescaped `$` are stripped from subpatterns, if both are present.
     * @param {String} [flags] Any combination of XRegExp flags.
     * @returns {RegExp} Regex with interpolated subpatterns.
     * @example
     *
     * const time = XRegExp.build('(?x)^ {{hours}} ({{minutes}}) $', {
     *   hours: XRegExp.build('{{h12}} : | {{h24}}', {
     *     h12: /1[0-2]|0?[1-9]/,
     *     h24: /2[0-3]|[01][0-9]/
     *   }, 'x'),
     *   minutes: /^[0-5][0-9]$/
     * });
     * time.test('10:59'); // -> true
     * XRegExp.exec('10:59', time).minutes; // -> '59'
     */
    XRegExp.build = (pattern, subs, flags) => {
        flags = flags || '';
        // Used with `asXRegExp` calls for `pattern` and subpatterns in `subs`, to work around how
        // some browsers convert `RegExp('\n')` to a regex that contains the literal characters `\`
        // and `n`. See more details at <https://github.com/slevithan/xregexp/pull/163>.
        const addFlagX = flags.includes('x');
        const inlineFlags = /^\(\?([\w$]+)\)/.exec(pattern);
        // Add flags within a leading mode modifier to the overall pattern's flags
        if (inlineFlags) {
            flags = XRegExp._clipDuplicates(flags + inlineFlags[1]);
        }

        const data = {};
        for (const p in subs) {
            if (subs.hasOwnProperty(p)) {
                // Passing to XRegExp enables extended syntax and ensures independent validity,
                // lest an unescaped `(`, `)`, `[`, or trailing `\` breaks the `(?:)` wrapper. For
                // subpatterns provided as native regexes, it dies on octals and adds the property
                // used to hold extended regex instance data, for simplicity.
                const sub = asXRegExp(subs[p], addFlagX);
                data[p] = {
                    // Deanchoring allows embedding independently useful anchored regexes. If you
                    // really need to keep your anchors, double them (i.e., `^^...$$`).
                    pattern: deanchor(sub.source),
                    names: sub[REGEX_DATA].captureNames || []
                };
            }
        }

        // Passing to XRegExp dies on octals and ensures the outer pattern is independently valid;
        // helps keep this simple. Named captures will be put back.
        const patternAsRegex = asXRegExp(pattern, addFlagX);

        // 'Caps' is short for 'captures'
        let numCaps = 0;
        let numPriorCaps;
        let numOuterCaps = 0;
        const outerCapsMap = [0];
        const outerCapNames = patternAsRegex[REGEX_DATA].captureNames || [];
        const output = patternAsRegex.source.replace(parts, ($0, $1, $2, $3, $4) => {
            const subName = $1 || $2;
            let capName;
            let intro;
            let localCapIndex;
            // Named subpattern
            if (subName) {
                if (!data.hasOwnProperty(subName)) {
                    throw new ReferenceError(`Undefined property ${$0}`);
                }
                // Named subpattern was wrapped in a capturing group
                if ($1) {
                    capName = outerCapNames[numOuterCaps];
                    outerCapsMap[++numOuterCaps] = ++numCaps;
                    // If it's a named group, preserve the name. Otherwise, use the subpattern name
                    // as the capture name
                    intro = `(?<${capName || subName}>`;
                } else {
                    intro = '(?:';
                }
                numPriorCaps = numCaps;
                const rewrittenSubpattern = data[subName].pattern.replace(subParts, (match, paren, backref) => {
                    // Capturing group
                    if (paren) {
                        capName = data[subName].names[numCaps - numPriorCaps];
                        ++numCaps;
                        // If the current capture has a name, preserve the name
                        if (capName) {
                            return `(?<${capName}>`;
                        }
                    // Backreference
                    } else if (backref) {
                        localCapIndex = +backref - 1;
                        // Rewrite the backreference
                        return data[subName].names[localCapIndex] ?
                            // Need to preserve the backreference name in case using flag `n`
                            `\\k<${data[subName].names[localCapIndex]}>` :
                            `\\${+backref + numPriorCaps}`;
                    }
                    return match;
                });
                return `${intro}${rewrittenSubpattern})`;
            }
            // Capturing group
            if ($3) {
                capName = outerCapNames[numOuterCaps];
                outerCapsMap[++numOuterCaps] = ++numCaps;
                // If the current capture has a name, preserve the name
                if (capName) {
                    return `(?<${capName}>`;
                }
            // Backreference
            } else if ($4) {
                localCapIndex = +$4 - 1;
                // Rewrite the backreference
                return outerCapNames[localCapIndex] ?
                    // Need to preserve the backreference name in case using flag `n`
                    `\\k<${outerCapNames[localCapIndex]}>` :
                    `\\${outerCapsMap[+$4]}`;
            }
            return $0;
        });

        return XRegExp(output, flags);
    };
};
