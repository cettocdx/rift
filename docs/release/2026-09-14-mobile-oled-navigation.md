# Mobile OLED and navigation

Phone-only changes (under 768 CSS pixels): true black dark chat canvas, a separate dark navigation surface, rounded model popup with model and reasoning controls together. Desktop parameter layout is unchanged. All supported models and effort levels remain available.

The navigation drawer enters and exits with transform/opacity animations. Closing immediately removes its accessibility and pointer interaction, restores focus, then unmounts it after 200 ms. Reduced-motion users receive a 1 ms animation.

Validation: 24 model-selector and mobile-shell tests passed, including mobile model/effort updates and an inert closing drawer. TypeScript and production build passed. The built CSS contains the OLED body tokens and drawer exit animation. These checks do not establish identical behavior or performance to ChatGPT, or real iOS/Android keyboard acceptance.

Live Preview (390 x 844): canvas rgb(0,0,0); model popup rgb(23,23,23), 15 px type and 24 px corners; navigation rgb(16,16,16), width 320 px, first eight buttons 44 px high with 15 px type. No horizontal document overflow. Closing returns focus to Open navigation. The legacy resize placement source test now identifies the actual drawer dialog rather than matching the former exact conditional spelling.
