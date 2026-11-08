/**
 * The HeyDarlink ambient shot list: ten frames without the girl per persona (views, food, drinks, interiors, flat lays,
 * city details, sunsets, outfits, books, flowers), each with the aspects it renders in, and the per-persona grade.
 * Moved from Quorum (`config/heydarlink-ambient.json`, PR #613) on 8 November 2026. Every prompt says, in its own
 * words, "no people", "no faces", "no text" and "no logos": FLUX dev reads only the positive prompt.
 * A `stockSeed` takes a Pexels photo of the landmark as an image-to-image seed; it is never posted as it is.
 */
export const HEYDARLINK_AMBIENT_SHOTS = {
  "personas": {
    "nina": {
      "home": "Prague",
      "grade": {
        "contrast": 0.92,
        "lift": 10,
        "warmth": 0.55,
        "saturation": 0.95,
        "grain": 0.03,
        "vignette": 0.04
      },
      "shots": [
        {
          "id": "nina-cafe-latte",
          "pillar": "drinks",
          "prompt": "Candid iPhone photo of a stoneware latte with leaf latte art on a worn marble café table by a rainy window in Žižkov, Prague, grey November window light from the left, a torn croissant on a small plate, shallow focus 50mm. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "nina-book-window",
          "pillar": "books",
          "prompt": "Candid phone photo of an open paperback novel and a pencil on a wooden windowsill, Prague rooftops blurred outside, soft overcast morning light from the left, a ceramic mug of black tea beside it, 35mm film look with slight grain. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "nina-vltava-dusk",
          "pillar": "views",
          "prompt": "Wide 26mm phone photo of the Vltava river at blue hour from Letná park, Charles Bridge and Prague Castle as distant silhouettes, warm street lamps reflecting on the water, slight haze, deep focus, empty foreground terrace railing. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ],
          "stockSeed": {
            "query": "prague vltava river dusk",
            "strength": 0.86
          }
        },
        {
          "id": "nina-letna-bench",
          "pillar": "city",
          "prompt": "Phone photo of an empty park bench under chestnut trees in Letná park, Prague, fallen autumn leaves on the gravel path, soft golden late-afternoon light, deep focus, quiet and still. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "nina-tram-window",
          "pillar": "city",
          "prompt": "Phone photo looking out through a rain-streaked Prague tram window at a blurred cobblestone street and yellow street lamps, condensation drops on the glass, moody evening light, 26mm deep focus, empty seats. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "nina-bookshop-shelf",
          "pillar": "books",
          "prompt": "Phone photo of a crowded second-hand bookshop shelf in Prague with worn spines in muted colours, warm tungsten light, shallow focus 50mm, dust in the air; spines blank and untitled. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "nina-flatlay-desk",
          "pillar": "flatlay",
          "prompt": "Overhead flat lay of a Czech vocabulary notebook with blank pages, a fountain pen, amber-coloured tea in a glass, a dried flower and a tram ticket-shaped blank paper on a linen tablecloth, soft window light from the left. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "nina-vilnius-old-town",
          "pillar": "views",
          "prompt": "Phone photo of a quiet cobblestone lane in Vilnius old town with pastel baroque facades and a church bell tower in the distance, early morning, soft mist, deep focus, empty street. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ],
          "stockSeed": {
            "query": "vilnius old town street",
            "strength": 0.86
          }
        },
        {
          "id": "nina-tulips-jar",
          "pillar": "flowers",
          "prompt": "Phone photo of loose white tulips in a glass jar on a kitchen table by the window, Prague courtyard blurred behind, soft overcast light from the left, shallow focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "nina-sunset-rooftops",
          "pillar": "sunset",
          "prompt": "Phone photo of terracotta Prague rooftops and chimneys at sunset from an attic window, warm orange sky fading to violet, slight haze, deep focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        }
      ]
    },
    "fatimah": {
      "home": "Dubai",
      "grade": {
        "contrast": 1.12,
        "lift": 0,
        "warmth": 0.4,
        "saturation": 1.04,
        "grain": 0.01,
        "vignette": 0.03
      },
      "shots": [
        {
          "id": "fatimah-matcha-marble",
          "pillar": "drinks",
          "prompt": "Editorial phone photo of an iced matcha latte in a tall clear glass on a white marble café counter in Dubai, bright clean morning light, crisp shadows from the right, shallow focus 50mm. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-desert-dunes",
          "pillar": "views",
          "prompt": "Wide phone photo of rippled golden sand dunes in the desert outside Dubai at golden hour, long soft shadows, hazy warm sky, deep focus, untouched sand. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-marina-night",
          "pillar": "views",
          "prompt": "Phone photo of Dubai Marina at night from a high balcony, glowing towers reflected in the water, gentle long-exposure light trails of boats, deep focus, empty balcony railing in the foreground. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ],
          "stockSeed": {
            "query": "dubai marina night skyline",
            "strength": 0.86
          }
        },
        {
          "id": "fatimah-fitting-rail",
          "pillar": "outfit",
          "prompt": "Phone photo of a clothing rail in a bright fitting studio with three satin evening dresses in champagne, black and emerald on wooden hangers, white walls, soft daylight, shallow focus; the clothes hang empty. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-heels-floor",
          "pillar": "outfit",
          "prompt": "Phone photo of a pair of nude stiletto heels standing on a pale travertine floor beside a garment bag, soft window light, minimal luxury interior, shallow focus 50mm; the shoes are empty. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-skincare-tray",
          "pillar": "flatlay",
          "prompt": "Overhead flat lay of unbranded glass skincare bottles, a jade roller and a folded white towel on a travertine bathroom tray, bright clean daylight, soft shadows; all bottles blank and unlabelled. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-hotel-pool",
          "pillar": "interiors",
          "prompt": "Phone photo of an empty infinity pool on a Dubai hotel rooftop at sunrise, still turquoise water, sun loungers with white towels, hazy skyline, deep focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-dates-coffee",
          "pillar": "food",
          "prompt": "Phone photo of Arabic coffee in a small gold-rimmed cup with a plate of Medjool dates on a low brass tray, soft warm afternoon light, shallow focus 50mm. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-orchids-suite",
          "pillar": "flowers",
          "prompt": "Phone photo of white orchids in a stone vase on a hotel suite side table, floor-to-ceiling window with a soft-focus Dubai skyline behind, bright clean light. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "fatimah-sunset-creek",
          "pillar": "sunset",
          "prompt": "Phone photo of traditional wooden abra boats moored on Dubai Creek at sunset, warm amber sky, calm water reflections, deep focus, empty boats. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        }
      ]
    },
    "teresa": {
      "home": "London",
      "grade": {
        "contrast": 0.95,
        "lift": 14,
        "warmth": -0.35,
        "saturation": 0.9,
        "grain": 0.03,
        "vignette": 0.05
      },
      "shots": [
        {
          "id": "teresa-tea-journal",
          "pillar": "drinks",
          "prompt": "Phone photo of a cup of milky English breakfast tea next to an open notebook with blank pages and a pencil on a scratched wooden desk, rainy London window light from the left, cool tones, shallow focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-heath-path",
          "pillar": "views",
          "prompt": "Phone photo of a misty footpath across Hampstead Heath in late autumn, bare oak trees and long wet grass, soft grey morning light, deep focus, empty path. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ],
          "stockSeed": {
            "query": "hampstead heath autumn path",
            "strength": 0.86
          }
        },
        {
          "id": "teresa-library-desk",
          "pillar": "books",
          "prompt": "Phone photo of a quiet university library reading desk with a green banker's lamp, stacked psychology textbooks with plain covers, tall wooden shelves blurred behind, warm lamp light against cool daylight. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-cinema-seats",
          "pillar": "interiors",
          "prompt": "Phone photo of empty red velvet seats in a small independent London cinema before the film, warm dim house lights, blank glowing screen in the distance, film grain. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-flatlay-study",
          "pillar": "flatlay",
          "prompt": "Overhead flat lay of index cards with blank sides, highlighters, a pair of reading glasses, a tea bag tag and an oat biscuit on a grey wool blanket, soft cool daylight. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-bristol-harbour",
          "pillar": "views",
          "prompt": "Phone photo of colourful terraced houses above Bristol harbourside on a bright blustery day, moored narrowboats, reflections in the water, deep focus, empty quay. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-rain-window",
          "pillar": "city",
          "prompt": "Phone photo through a rain-covered sash window onto a wet London street of brick terraces at dusk, street lamps glowing, raindrops in sharp focus, background soft. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-bookshop-stack",
          "pillar": "books",
          "prompt": "Phone photo of a precarious stack of second-hand paperbacks on the floor of a London bookshop, plain faded spines, warm lamp light, shallow focus; spines blank and untitled. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-daffodils",
          "pillar": "flowers",
          "prompt": "Phone photo of daffodils in a chipped enamel jug on a windowsill, cool spring light, blurred brick wall outside, shallow focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "teresa-sunset-primrose",
          "pillar": "sunset",
          "prompt": "Phone photo of the London skyline from Primrose Hill at sunset, pastel pink and grey sky, silhouetted trees in the foreground, deep focus, empty grass slope. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ],
          "stockSeed": {
            "query": "london skyline primrose hill sunset",
            "strength": 0.86
          }
        }
      ]
    },
    "michaela": {
      "home": "Prague",
      "grade": {
        "contrast": 1.1,
        "lift": -6,
        "warmth": 0.15,
        "saturation": 1.08,
        "grain": 0.02,
        "vignette": 0.05
      },
      "shots": [
        {
          "id": "michaela-set-lights",
          "pillar": "interiors",
          "prompt": "Behind-the-scenes phone photo of an empty photo studio in Holešovice, Prague: a softbox light, a seamless paper backdrop and a camera on a tripod, concrete floor, cool daylight mixed with tungsten, deep focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "michaela-pilates-reformer",
          "pillar": "interiors",
          "prompt": "Phone photo of an empty pilates reformer in a bright minimalist studio, light wooden floor, large windows with soft morning light, a rolled mat and a water bottle beside it, deep focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "michaela-holesovice-street",
          "pillar": "city",
          "prompt": "Phone photo of a converted industrial street in Holešovice, Prague, red brick warehouses, a tram line and bicycles leaning on a railing, late afternoon side light, deep focus, empty pavement. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "michaela-road-trip",
          "pillar": "views",
          "prompt": "Phone photo through a car windscreen of an empty winding road through the Beskydy hills in early autumn, dashboard edge in the foreground, golden light, slight lens flare, deep focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ],
          "stockSeed": {
            "query": "winding road hills autumn",
            "strength": 0.86
          }
        },
        {
          "id": "michaela-pool-deck",
          "pillar": "interiors",
          "prompt": "Phone photo of an empty outdoor pool on a summer evening, turquoise water with ripples, a striped towel on a sun lounger, warm low sun, deep focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "michaela-flatlay-shoot",
          "pillar": "flatlay",
          "prompt": "Overhead flat lay of a camera body, two lenses, a light meter, a shot list on blank paper, a lipstick and a pair of sunglasses on a concrete surface, hard daylight with crisp shadows; all items unbranded. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "michaela-espresso-counter",
          "pillar": "drinks",
          "prompt": "Phone photo of a double espresso in a white cup on a steel café counter in Prague, tram passing blurred through the window, crisp morning light, shallow focus 50mm. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "michaela-ostrava-vitkovice",
          "pillar": "views",
          "prompt": "Phone photo of the old Vítkovice ironworks blast furnaces in Ostrava at dusk, rusted steel structures against a deep blue sky, warm work lights, deep focus, empty walkway. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ],
          "stockSeed": {
            "query": "ostrava vitkovice ironworks",
            "strength": 0.86
          }
        },
        {
          "id": "michaela-peonies",
          "pillar": "flowers",
          "prompt": "Phone photo of pink peonies wrapped in brown paper lying on the passenger seat of a car, soft side light through the window, shallow focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        },
        {
          "id": "michaela-sunset-riegrovy",
          "pillar": "sunset",
          "prompt": "Phone photo of the Prague skyline at sunset from Riegrovy sady, warm red sky, spires and domes as silhouettes, a picnic blanket and two glasses of wine on the grass in the foreground, deep focus. No people, no faces, no hands, no body parts, no text, no lettering, no logos, no watermark.",
          "aspects": [
            "4:5",
            "9:16"
          ]
        }
      ]
    }
  },
  "negative": "people, person, face, portrait, hands, fingers, body, silhouette of a person, crowd, text, letters, words, signage, logo, brand name, watermark, caption"
} as const;
