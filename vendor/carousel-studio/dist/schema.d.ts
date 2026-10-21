import { z } from "zod";
/** The four canvases a template is composed and checked for. `canvas.ts` owns the list. */
export declare const CarouselCanvasSchema: z.ZodEnum<{
    "instagram-square": "instagram-square";
    "instagram-portrait": "instagram-portrait";
    "instagram-story": "instagram-story";
    threads: "threads";
}>;
export declare const CarouselFormatSchema: z.ZodEnum<{
    "instagram-square": "instagram-square";
    "instagram-portrait": "instagram-portrait";
    "instagram-story": "instagram-story";
    threads: "threads";
    "linkedin-square": "linkedin-square";
}>;
export declare const TemplateStatusSchema: z.ZodEnum<{
    draft: "draft";
    live: "live";
    deprecated: "deprecated";
}>;
/**
 * The languages this engine sets type in.
 *
 * Not the same enum as a payload's `locale`, which is the language of a *delivered record* and
 * has only ever been Czech or English. This one is the language of a *frame*: the bilingual
 * Tehdejší svět card sets Ukrainian in half of its slots while the record around it stays Czech.
 */
export declare const PublishingLocaleSchema: z.ZodEnum<{
    cs: "cs";
    en: "en";
    uk: "uk";
}>;
export declare const PUBLISHING_LOCALES: ("cs" | "en" | "uk")[];
export type PublishingLocale = z.infer<typeof PublishingLocaleSchema>;
/** The first template language: one optional photograph per template, in the slot `image`. */
export declare const CAROUSEL_TEMPLATE_V1: "carousel-template/1";
/**
 * The second (quorum#603): several photographs per template and per slide, each in its own slot,
 * a required photograph that refuses to render without its bytes, a shade over a photograph and
 * bottom- or middle-anchored text. Everything it adds is refused in a v1 document, so a v1
 * template parses to exactly the object it always did and renders the bytes it always did.
 */
export declare const CAROUSEL_TEMPLATE_V2: "carousel-template/2";
export declare const CAROUSEL_TEMPLATE_VERSIONS: readonly ["carousel-template/1", "carousel-template/2"];
/** An image slot: `image`, or `image-1` to `image-99`. v1 allows only `image`. */
export declare const IMAGE_SLOT_PATTERN: RegExp;
export declare const ImageSlotSchema: z.ZodString;
/** The most distinct photographs one v2 template may hold: Instagram's own per-post ceiling. */
export declare const MAX_IMAGE_SLOTS = 20;
export declare const CarouselLayerSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    type: z.ZodLiteral<"text">;
    slot: z.ZodString;
    colorToken: z.ZodString;
    fontToken: z.ZodEnum<{
        headline: "headline";
        body: "body";
        mono: "mono";
    }>;
    fontWeight: z.ZodNumber;
    minFontSize: z.ZodNumber;
    maxFontSize: z.ZodNumber;
    maxChars: z.ZodNumber;
    maxLines: z.ZodNumber;
    align: z.ZodDefault<z.ZodEnum<{
        start: "start";
        middle: "middle";
        end: "end";
    }>>;
    uppercase: z.ZodDefault<z.ZodBoolean>;
    tracking: z.ZodDefault<z.ZodNumber>;
    glow: z.ZodDefault<z.ZodBoolean>;
    lang: z.ZodOptional<z.ZodEnum<{
        cs: "cs";
        en: "en";
        uk: "uk";
    }>>;
    valign: z.ZodOptional<z.ZodEnum<{
        middle: "middle";
        top: "top";
        bottom: "bottom";
    }>>;
    keepWithNext: z.ZodOptional<z.ZodEnum<{
        cs: "cs";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    type: z.ZodLiteral<"shape">;
    fillToken: z.ZodString;
    strokeToken: z.ZodOptional<z.ZodString>;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    radius: z.ZodDefault<z.ZodNumber>;
    padText: z.ZodOptional<z.ZodString>;
    padding: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    type: z.ZodLiteral<"rule">;
    colorToken: z.ZodString;
    thickness: z.ZodNumber;
    dash: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>, z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    type: z.ZodLiteral<"logo">;
    colorToken: z.ZodString;
    fontToken: z.ZodDefault<z.ZodEnum<{
        headline: "headline";
        body: "body";
        mono: "mono";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    type: z.ZodLiteral<"image">;
    slot: z.ZodString;
    optional: z.ZodBoolean;
    fit: z.ZodEnum<{
        cover: "cover";
        contain: "contain";
    }>;
    scrim: z.ZodDefault<z.ZodEnum<{
        bottom: "bottom";
        none: "none";
        full: "full";
    }>>;
    clip: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"circle">, z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>]>>;
    treatment: z.ZodDefault<z.ZodEnum<{
        mono: "mono";
        none: "none";
        duotone: "duotone";
    }>>;
    reprise: z.ZodDefault<z.ZodBoolean>;
    shade: z.ZodOptional<z.ZodObject<{
        colorToken: z.ZodString;
        stops: z.ZodArray<z.ZodObject<{
            at: z.ZodNumber;
            opacity: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    border: z.ZodOptional<z.ZodObject<{
        colorToken: z.ZodString;
        width: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    type: z.ZodLiteral<"mesh">;
    blobs: z.ZodArray<z.ZodObject<{
        colorToken: z.ZodString;
        cx: z.ZodNumber;
        cy: z.ZodNumber;
        radius: z.ZodNumber;
        opacity: z.ZodNumber;
    }, z.core.$strip>>;
    softness: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    type: z.ZodLiteral<"linear-gradient">;
    angle: z.ZodNumber;
    stops: z.ZodTuple<[z.ZodObject<{
        colorToken: z.ZodString;
        offset: z.ZodNumber;
    }, z.core.$strip>, z.ZodObject<{
        colorToken: z.ZodString;
        offset: z.ZodNumber;
    }, z.core.$strip>], null>;
}, z.core.$strip>], "type">;
export declare const CarouselTemplateSchema: z.ZodObject<{
    schemaVersion: z.ZodEnum<{
        "carousel-template/1": "carousel-template/1";
        "carousel-template/2": "carousel-template/2";
    }>;
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    status: z.ZodEnum<{
        draft: "draft";
        live: "live";
        deprecated: "deprecated";
    }>;
    description: z.ZodString;
    citedObservationRefs: z.ZodArray<z.ZodString>;
    formats: z.ZodObject<{
        "instagram-square": z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            safeArea: z.ZodObject<{
                top: z.ZodNumber;
                right: z.ZodNumber;
                bottom: z.ZodNumber;
                left: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        "instagram-portrait": z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            safeArea: z.ZodObject<{
                top: z.ZodNumber;
                right: z.ZodNumber;
                bottom: z.ZodNumber;
                left: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
        "instagram-story": z.ZodDefault<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            safeArea: z.ZodObject<{
                top: z.ZodNumber;
                right: z.ZodNumber;
                bottom: z.ZodNumber;
                left: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        threads: z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            safeArea: z.ZodObject<{
                top: z.ZodNumber;
                right: z.ZodNumber;
                bottom: z.ZodNumber;
                left: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    canvas: z.ZodDefault<z.ZodObject<{
        master: z.ZodDefault<z.ZodEnum<{
            "instagram-square": "instagram-square";
            "instagram-portrait": "instagram-portrait";
            "instagram-story": "instagram-story";
            threads: "threads";
        }>>;
        derive: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            "instagram-square": "instagram-square";
            "instagram-portrait": "instagram-portrait";
            "instagram-story": "instagram-story";
            threads: "threads";
        }>>>;
    }, z.core.$strip>>;
    requiredSlots: z.ZodArray<z.ZodString>;
    slides: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        backgroundToken: z.ZodString;
        layers: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            type: z.ZodLiteral<"text">;
            slot: z.ZodString;
            colorToken: z.ZodString;
            fontToken: z.ZodEnum<{
                headline: "headline";
                body: "body";
                mono: "mono";
            }>;
            fontWeight: z.ZodNumber;
            minFontSize: z.ZodNumber;
            maxFontSize: z.ZodNumber;
            maxChars: z.ZodNumber;
            maxLines: z.ZodNumber;
            align: z.ZodDefault<z.ZodEnum<{
                start: "start";
                middle: "middle";
                end: "end";
            }>>;
            uppercase: z.ZodDefault<z.ZodBoolean>;
            tracking: z.ZodDefault<z.ZodNumber>;
            glow: z.ZodDefault<z.ZodBoolean>;
            lang: z.ZodOptional<z.ZodEnum<{
                cs: "cs";
                en: "en";
                uk: "uk";
            }>>;
            valign: z.ZodOptional<z.ZodEnum<{
                middle: "middle";
                top: "top";
                bottom: "bottom";
            }>>;
            keepWithNext: z.ZodOptional<z.ZodEnum<{
                cs: "cs";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            type: z.ZodLiteral<"shape">;
            fillToken: z.ZodString;
            strokeToken: z.ZodOptional<z.ZodString>;
            strokeWidth: z.ZodDefault<z.ZodNumber>;
            radius: z.ZodDefault<z.ZodNumber>;
            padText: z.ZodOptional<z.ZodString>;
            padding: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            type: z.ZodLiteral<"rule">;
            colorToken: z.ZodString;
            thickness: z.ZodNumber;
            dash: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>, z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            type: z.ZodLiteral<"logo">;
            colorToken: z.ZodString;
            fontToken: z.ZodDefault<z.ZodEnum<{
                headline: "headline";
                body: "body";
                mono: "mono";
            }>>;
        }, z.core.$strip>, z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            type: z.ZodLiteral<"image">;
            slot: z.ZodString;
            optional: z.ZodBoolean;
            fit: z.ZodEnum<{
                cover: "cover";
                contain: "contain";
            }>;
            scrim: z.ZodDefault<z.ZodEnum<{
                bottom: "bottom";
                none: "none";
                full: "full";
            }>>;
            clip: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<"circle">, z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>]>>;
            treatment: z.ZodDefault<z.ZodEnum<{
                mono: "mono";
                none: "none";
                duotone: "duotone";
            }>>;
            reprise: z.ZodDefault<z.ZodBoolean>;
            shade: z.ZodOptional<z.ZodObject<{
                colorToken: z.ZodString;
                stops: z.ZodArray<z.ZodObject<{
                    at: z.ZodNumber;
                    opacity: z.ZodNumber;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            border: z.ZodOptional<z.ZodObject<{
                colorToken: z.ZodString;
                width: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>, z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            type: z.ZodLiteral<"mesh">;
            blobs: z.ZodArray<z.ZodObject<{
                colorToken: z.ZodString;
                cx: z.ZodNumber;
                cy: z.ZodNumber;
                radius: z.ZodNumber;
                opacity: z.ZodNumber;
            }, z.core.$strip>>;
            softness: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>, z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
            type: z.ZodLiteral<"linear-gradient">;
            angle: z.ZodNumber;
            stops: z.ZodTuple<[z.ZodObject<{
                colorToken: z.ZodString;
                offset: z.ZodNumber;
            }, z.core.$strip>, z.ZodObject<{
                colorToken: z.ZodString;
                offset: z.ZodNumber;
            }, z.core.$strip>], null>;
        }, z.core.$strip>], "type">>;
        variants: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            backgroundToken: z.ZodOptional<z.ZodString>;
            accentToken: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const BrandTokensSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"carousel-brand/1">;
    id: z.ZodEnum<{
        "caught-up": "caught-up";
        "mma-files": "mma-files";
        "titty-tuesdays": "titty-tuesdays";
        devshark: "devshark";
        kvorum: "kvorum";
        booksofhistory: "booksofhistory";
        "door-money": "door-money";
        "tehdejsi-svet": "tehdejsi-svet";
        "webdev-signal": "webdev-signal";
    }>;
    name: z.ZodString;
    logoText: z.ZodString;
    kit: z.ZodOptional<z.ZodString>;
    colors: z.ZodRecord<z.ZodString, z.ZodString>;
    fonts: z.ZodObject<{
        headline: z.ZodString;
        body: z.ZodString;
        mono: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
/**
 * How one photograph is framed in its slot: the point to keep in view, how far to zoom in, and
 * whether the frame is filled or the whole picture shown.
 *
 * Part of the payload, so it is hashed with the words: an approval covers the crop that was seen.
 * The bytes are not — they travel beside the payload, and `assetSha256` names which ones the crop
 * was set on, so a reader holding the original file can prove it is the same picture.
 */
export declare const ImageCropSchema: z.ZodObject<{
    assetSha256: z.ZodOptional<z.ZodString>;
    focal: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strict>;
    zoom: z.ZodOptional<z.ZodNumber>;
    fit: z.ZodOptional<z.ZodEnum<{
        cover: "cover";
        contain: "contain";
    }>>;
}, z.core.$strict>;
export declare const CarouselPayloadSchema: z.ZodObject<{
    locale: z.ZodEnum<{
        cs: "cs";
        en: "en";
    }>;
    strings: z.ZodRecord<z.ZodString, z.ZodString>;
    variant: z.ZodOptional<z.ZodString>;
    images: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        assetSha256: z.ZodOptional<z.ZodString>;
        focal: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, z.core.$strict>;
        zoom: z.ZodOptional<z.ZodNumber>;
        fit: z.ZodOptional<z.ZodEnum<{
            cover: "cover";
            contain: "contain";
        }>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const TemplateReferenceSchema: z.ZodObject<{
    template_id: z.ZodString;
    version: z.ZodString;
    content: z.ZodObject<{
        locale: z.ZodEnum<{
            cs: "cs";
            en: "en";
        }>;
        strings: z.ZodRecord<z.ZodString, z.ZodString>;
        variant: z.ZodOptional<z.ZodString>;
        images: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            assetSha256: z.ZodOptional<z.ZodString>;
            focal: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, z.core.$strict>;
            zoom: z.ZodOptional<z.ZodNumber>;
            fit: z.ZodOptional<z.ZodEnum<{
                cover: "cover";
                contain: "contain";
            }>>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
}, z.core.$strip>;
export type CarouselFormat = z.infer<typeof CarouselFormatSchema>;
/** The four canvases a template is composed for; its `formats` object has exactly these keys. */
export type CarouselCanvas = z.infer<typeof CarouselCanvasSchema>;
/** The canvas a format draws on. Every read of `template.formats` goes through this. */
export declare function carouselCanvas(format: CarouselFormat): CarouselCanvas;
export type CarouselLayer = z.infer<typeof CarouselLayerSchema>;
/**
 * A layer as an author writes one, before defaults are filled in.
 *
 * Every capability added to this schema is optional with a default, so the parsed type gains a
 * required field for each. Generators build the *input* shape and let the parse complete it,
 * which is what keeps adding a capability from being a rewrite of every template in the library.
 */
export type CarouselLayerInput = z.input<typeof CarouselLayerSchema>;
export type CarouselTemplate = z.infer<typeof CarouselTemplateSchema>;
/** A template as an author writes one: every defaulted capability may be left out. */
export type CarouselTemplateInput = z.input<typeof CarouselTemplateSchema>;
export type BrandTokens = z.infer<typeof BrandTokensSchema>;
export type CarouselPayload = z.infer<typeof CarouselPayloadSchema>;
export type ImageCrop = z.infer<typeof ImageCropSchema>;
export type TemplateReference = z.infer<typeof TemplateReferenceSchema>;
//# sourceMappingURL=schema.d.ts.map