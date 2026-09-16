# Ingredient percentage basis for the Lailark label: the clause, the reading, the numbers

Prepared 14 Sep 2026. For Prawns & Dates Pickle, batch 001. Not legal advice. Take this to the consultant as a starting position, not a conclusion.

Verification note: the clause text below was pulled from the FSSAI-hosted consolidated compendium, Version VIII dated 09.09.2025, and cross-checked for 5(2)(b) and 5(2)(g) against an independent bare-act copy. Read the two clauses on the PDF yourself before a print run.

For the build: this doc settles what the recipe engine's "percentage basis" switch computes. The recommended basis is column B below (ingoing weight over ingoing total minus evaporated water). Build the switch with three positions (A, B, C as defined in section 4) and default to B.

---

## 1. The clauses, quoted

Source: Food Safety and Standards (Labelling and Display) Regulations, 2020, consolidated compendium Version VIII (09.09.2025), Regulation 5(2).

**Opening words of 5(2):**

> List of Ingredients: Except for single ingredient foods, a list of ingredients shall be declared on the label in the following manner:-

**5(2)(b), the ordering rule:**

> The name of ingredients used in the product shall be listed in descending order of their composition by weight or volume, as the case may be at the time of its manufacture

**5(2)(e), compound ingredients:**

> Where an ingredient is itself the product of two or more ingredients, such a compound ingredient shall be declared, by their specific names; (i) as such, in the list of ingredients, provided that it is immediately accompanied by a list, in brackets, of its ingredients in descending order of proportion (m/m) at the time of manufacture of such compound ingredients: or (ii) by declaring all of the ingredients of compound ingredient as if they were individual ingredients of the final food:
>
> Provided that where a compound ingredient constitutes less than 5 per cent. of the food, the ingredients, other than food additives that serve the technological function in the food products, need not be declared

**5(2)(f), water and volatiles:**

> Added water shall be declared in the list of ingredients except in cases where water forms part of an ingredient, such as, brine, syrup or broth, used in the compound food and so declared in the list of ingredients:
>
> Provided that water or other volatile ingredients evaporated in the course of manufacture need not be declared;

**5(2)(g), the percentage rule:**

> The ingoing percentage of an ingredient (including compound ingredients or categories of ingredients), by weight or volume as appropriate, at the time of manufacture, shall be disclosed for foods sold as a mixture or combination where the ingredient:
>
> (i) is emphasized as present on the label through words or pictures or graphics; or
>
> (ii) is not within the name of the food but, is essential to characterise the food and is expected to be present in the food by consumers, and if the omission of the quantitative ingredient declaration will mislead or deceive the consumer:
>
> Provided that such disclosures are not required where the ingredients are used as flavouring agents including spices or condiments or herbs or their extracts or mixed masalas or seasonings; [and further provisos on drained weight, specific provisions, serving suggestions and added micro-nutrients]

### What the clause settles and what it does not

Settled:

- The basis is **ingoing quantity at the time of manufacture**, by weight or volume. Not the quantity present in the finished jar.
- Water and other volatile ingredients that evaporate during manufacture **need not be declared** at all.
- The percentage is owed only for ingredients that are **emphasised**, or essential to characterise the food. It is not owed for every ingredient.
- Spices, condiments, herbs and masalas used as flavouring are **exempt**, even when named on the pack.

Not settled:

- **There is no denominator.** The clause never says percentage *of what*.
- **There is no moisture-loss provision.**
- **"Ingoing" is undefined.** For prawns there are three candidate weights and the regulation picks none of them.
- FSSAI has published no guidance note or FAQ on either point.

For contrast, the EU (Annex VIII of Regulation (EU) 1169/2011) says that where a food has lost moisture through cooking the declaration should correspond to the quantity in the finished product, and where the ingoing quantity exceeds 100% the percentage is replaced by a statement of weight used. That is **not Indian law**, but it is evidence of accepted international practice.

---

## 2. Where the printed numbers sit

The printed batch 001 label says Prawns 59%, Dates 22%.

Both numbers are ingoing weight divided by finished weight. The dates go in at 1 kg and are still 1 kg in the jar, so 22% describes the jar. The prawns go in at 2.7 kg of market weight and end up as 1.12 kg of fried prawn, so 59% describes a purchase, not a jar. A consumer reading "Prawns 59%" on a 200 g jar will believe there are 118 g of prawn in it. There are about 51 g. That is a misleading-label exposure under the general prohibition.

---

## 3. Which prawn weight is "ingoing"

| Weight | Figure | What it is |
|---|---|---|
| Market / landed | 2.70 kg | Includes shell and head. Bought, not cooked. |
| Cleaned, raw | ~1.55 kg (estimated, not recorded) | The prawn as it enters the recipe. |
| Fried | 1.12 kg | The prawn as it sits in the jar. |

**The market weight is not the ingoing quantity.** Shell and head are removed and never become part of the food.

**The cleaned raw weight is the best fit for "ingoing at the time of manufacture."** This is the defensible answer.

**The fried weight is the "as present in the finished product" figure.** It is the conservative choice.

So: **not 2.7 kg. Either 1.55 kg (ingoing, literal reading) or 1.12 kg (in-jar, consumer reading).** Weigh the cleaned prawns on the next batch and record it. That single measurement is the weakest link in the whole declaration. This is why the Batch object records three weights: raw, cleaned, cooked.

---

## 4. Worked example

Quantities in grams. Spice weights are illustrative placeholders. **Replace every one with the recorded batch weights before this goes near a printer.** Oil at 0.92 kg/L; vinegar at 1.00 kg/L. Vinegar residue after the boil taken as 400 g (estimate).

| Ingredient | Ingoing g | A: % of ingoing total | B: % of adjusted total (recommended) | C: g per 100 g finished |
|---|---:|---:|---:|---:|
| Prawns, cleaned raw | 1,550 | 25.7% | **35.0%** | 35.2 |
| Vinegar (2 L in, ~400 g stays) | 2,000 | 33.2% | 9.0% | 45.5 |
| Dates | 1,000 | 16.6% | **22.6%** | 22.7 |
| Gingelly oil (1 L) | 920 | 15.3% | 20.8% | 20.9 |
| Garlic | 150 | 2.5% | 3.4% | 3.4 |
| Green chilli | 100 | 1.7% | 2.3% | 2.3 |
| Salt | 90 | 1.5% | 2.0% | 2.0 |
| Ginger | 80 | 1.3% | 1.8% | 1.8 |
| Chilli powders (Kashmiri + hot) | 60 | 1.0% | 1.4% | 1.4 |
| Sugar | 40 | 0.7% | 0.9% | 0.9 |
| Mustard | 15 | 0.3% | 0.3% | 0.3 |
| Curry leaves | 10 | 0.2% | 0.2% | 0.2 |
| Turmeric | 8 | 0.1% | 0.2% | 0.2 |
| Fenugreek | 5 | 0.1% | 0.1% | 0.1 |
| Compounded asafoetida | 5 | 0.1% | 0.1% | 0.1 |
| **Total** | **6,033** | **100.00%** | **100.00%** | **137.1** |

Column A: every ingoing weight over the ingoing total of 6,033 g, vinegar included at its full 2 kg. Legally clean, commercially unfair, and less informative.

Column B: the same ingoing weights, with the evaporated portion of the vinegar removed from the denominator under the first proviso to 5(2)(f). Adjusted total 4,433 g. **This is the recommended basis.**

Column C: ingoing over finished weight, the method used on the printed label. Sums to 137 g per 100 g, which proves it cannot be expressed as a set of percentages.

### Why column B

The adjusted ingoing total, 4,433 g, lands within 1% of the finished weight of 4,400 g. Once you take out the water that boiled off, what remains is the jar. Column B is simultaneously an ingoing declaration (what 5(2)(g) asks for) and an accurate description of the jar (what a consumer and an inspector will check). It sums to 100%.

**Declared figures on basis B: Prawns 35%, Dates 23%.**

Maximally conservative alternative: fried weight, Prawns 25%, Dates 23%.

Do not use 59% as a bare percentage. If the prawn-buying story belongs on the pack, it is a separate sentence: *"Made with 2.7 kg of fresh prawns per 22 jars."*

### Ordering ambiguity

5(2)(b) orders ingredients by composition "at the time of its manufacture." A literal reading puts Vinegar first. The sensible reading (evaporated water leaves the calculation) puts it fourth. Flag to the consultant.

---

## 5. Compounded asafoetida

Standardised under FSS (Food Products Standards and Food Additives) Regulations, 2011, clause 2.9.29. The standard sets no minimum asafoetida content.

At roughly 5 g in a 6 kg batch it is below 5% of the food, so **sub-ingredients need not be declared**. If declared voluntarily, the bracketed list must be in descending order (m/m), which needs the supplier's actual composition.

**The allergen is not optional.** Regulation 5(14) requires a separate "Contains" declaration with no 5% threshold. If the compounded asafoetida contains wheat flour, "Wheat (Gluten)" must appear. Prawns put "Crustacean" there regardless.

Sesame and mustard are **not** in the FSSAI 5(14) list (the eight are: cereals containing gluten, crustacean, milk, eggs, fish, peanuts and tree nuts, soybeans, sulphite at 10 mg/kg or more). Declaring them is voluntary and good practice, especially for EU or UK export.

**Action:** get the asafoetida supplier's written composition and FSSAI licence number. A rice-flour hing would remove the wheat declaration.

---

## 6. What to do before the next print run

1. Weigh the cleaned prawns on the next batch and record it.
2. Record the actual weights of every spice, salt and sugar.
3. Measure the pot weight before and after the boil to get the real vinegar residue.
4. Get the asafoetida supplier's composition in writing.
5. Put the three open questions to the consultant in one page: the denominator, whether the evaporated volume also leaves the 5(2)(b) ordering, and allergens inside a sub-5% compound ingredient.

---

## Sources

- FSS (Labelling and Display) Regulations, 2020, consolidated compendium Version VIII, 09.09.2025: https://fssai.gov.in/docs/food-law/regulations/Comp_Labelling%20Display_Version%20VIII_09_09_2025.pdf
- FSS (Food Products Standards and Food Additives) Regulations, 2011, Chapter 2.9: https://www.fssai.gov.in/upload/uploadfiles/files/10_%20Chapter%202_9%20(Salt,%20Spices,%20Condiments%20and%20related%20products).pdf
- EU comparator, QUID and moisture loss, Food Safety Authority of Ireland: https://www.fsai.ie/business-advice/labelling/labelling-general-labelling/quid
