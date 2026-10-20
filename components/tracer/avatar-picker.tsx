/**
 * -------------------------------------------------------------------------
 * @file   avatar-picker.tsx
 * @brief  Lets a user choose a Gaze avatar from a shuffleable set.
 *
 * @description
 *  Shows the user's current Gaze face beside freshly randomized ones as
 *  selectable tiles. Shuffle deals a new set while keeping the selected
 *  face in place. One radio group carries the chosen seed; the caller
 *  stores it with the rest of the profile.
 *
 * @remarks
 *  Adapted from the ReUI avatar card radio group (c-radio-group-12), laid
 *  out as a grid. Each tile is a label for its radio, so the whole tile is
 *  the hit target and arrow keys move between faces. Random seeds are drawn
 *  in the browser, so render the picker only after client data loads, as
 *  Account Settings does, never in a server render.
 *
 * @see
 *  data/avatar.ts
 *  https://reui.io/components/radio-group/c-radio-group-12
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { ShuffleIcon } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { avatarUrl, randomAvatarSeed } from "@/data/avatar";

const optionCount = 12;

interface AvatarPickerProps {
  initials: string;
  value: string;
  onValueChange: (seed: string) => void;
  disabled?: boolean;
}

/** The selected seed first, then random ones up to the option count. */
function dealOptions(selected: string): string[] {
  const seeds = new Set([selected]);
  while (seeds.size < optionCount) seeds.add(randomAvatarSeed());
  return [...seeds];
}

export function AvatarPicker({ initials, value, onValueChange, disabled }: AvatarPickerProps) {
  const [options, setOptions] = useState(() => dealOptions(value));
  // Keep a seed chosen elsewhere (such as a reload of saved data) on the grid.
  const visible = options.includes(value) ? options : [value, ...options.slice(0, optionCount - 1)];

  return (
    <div className="flex flex-col items-start gap-3">
      <RadioGroup
        value={value}
        onValueChange={(next) => onValueChange(String(next))}
        disabled={disabled}
        className="grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"
      >
        {visible.map((seed, index) => {
          const id = `avatar-option-${index}`;
          return (
            <FieldLabel key={seed} htmlFor={id} className="p-0!">
              <Field orientation="horizontal" className="relative justify-center py-3!">
                <span id={`${id}-name`} className="sr-only">
                  {`Avatar ${index + 1}`}
                </span>
                <Avatar size="lg">
                  <AvatarImage src={avatarUrl(seed)} alt="" />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                {/* Base UI moves `id` to its hidden input, so name the visible radio directly. */}
                <RadioGroupItem value={seed} id={id} aria-labelledby={`${id}-name`} className="absolute top-2 right-2" />
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOptions(dealOptions(value))}>
        <ShuffleIcon aria-hidden="true" />
        Shuffle
      </Button>
    </div>
  );
}
