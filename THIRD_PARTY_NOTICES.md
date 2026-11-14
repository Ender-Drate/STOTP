# Third-party notices

The 3D scene CAPTCHA in `lib/captcha.ts` and the click interaction in
`app/components/ShapeCaptcha.tsx` were adapted from the following MIT-licensed
projects. Their concepts and shape drawing/verification approaches informed
this implementation; the code here is a TypeScript rewrite for this project.

## sswahn/captcha

- Source: https://github.com/sswahn/captcha
- License: MIT
- Copyright (c) 2023 sswahn

Used as a reference for drawing geometric shapes on a canvas and for the
click-to-select interaction.

## Moroura/shape-captcha-lib

- Source: https://github.com/Moroura/shape-captcha-lib
- License: MIT
- Copyright (c) 2025 Moroura

Used as a reference for server-side challenge generation and verifying a click
coordinate against the target shape geometry.

## MIT license text

Copyright (c) 2023 sswahn
Copyright (c) 2025 Moroura

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
