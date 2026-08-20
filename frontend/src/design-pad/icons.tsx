"use client";
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(children: React.ReactNode, props: IconProps) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconSave = (p: IconProps) =>
  base(
    <>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 4v5h8V4" />
      <rect x="8" y="14" width="8" height="6" />
    </>,
    p,
  );

export const IconLoad = (p: IconProps) =>
  base(
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 11v5" />
      <path d="M9.5 13.5 12 16l2.5-2.5" />
    </>,
    p,
  );

export const IconFile = (p: IconProps) =>
  base(
    <>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 13h5" />
      <path d="M12 10.5v5" />
    </>,
    p,
  );

export const IconTrash = (p: IconProps) =>
  base(
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>,
    p,
  );

export const IconPlus = (p: IconProps) =>
  base(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    p,
  );

export const IconCode = (p: IconProps) =>
  base(
    <>
      <path d="M9 8 4.5 12 9 16" />
      <path d="M15 8l4.5 4-4.5 4" />
    </>,
    p,
  );

export const IconZoomIn = (p: IconProps) =>
  base(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
      <path d="M11 8.5v5" />
      <path d="M8.5 11h5" />
    </>,
    p,
  );

export const IconZoomOut = (p: IconProps) =>
  base(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
      <path d="M8.5 11h5" />
    </>,
    p,
  );

export const IconZoomReset = (p: IconProps) =>
  base(
    <>
      <path d="M4 9.5A8 8 0 0 1 19 8" />
      <path d="M20 4v5h-5" />
      <path d="M20 14.5A8 8 0 0 1 5 16" />
      <path d="M4 20v-5h5" />
    </>,
    p,
  );

export const IconBoxShape = (p: IconProps) =>
  base(
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M4 9.5h16" />
    </>,
    p,
  );

export const IconUndo = (p: IconProps) =>
  base(
    <>
      <path d="M7 7 3.5 10.5 7 14" />
      <path d="M3.5 10.5H14a5.5 5.5 0 0 1 0 11h-3" />
    </>,
    p,
  );

export const IconRedo = (p: IconProps) =>
  base(
    <>
      <path d="M17 7l3.5 3.5L17 14" />
      <path d="M20.5 10.5H10a5.5 5.5 0 0 0 0 11h3" />
    </>,
    p,
  );

export const IconHeadingShape = (p: IconProps) =>
  base(
    <>
      <path d="M5 5v14" />
      <path d="M13 5v14" />
      <path d="M5 12h8" />
      <path d="M16.5 8.5h3.5" />
      <path d="M18 8.5v6.5" />
    </>,
    p,
  );

export const IconParagraphShape = (p: IconProps) =>
  base(
    <>
      <path d="M5 6h14" />
      <path d="M5 10.5h14" />
      <path d="M5 15h9" />
      <path d="M5 19h6" />
    </>,
    p,
  );

export const IconImageShape = (p: IconProps) =>
  base(
    <>
      <rect x="4" y="4.5" width="16" height="15" rx="1.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m6 17 4.2-4.5a1.2 1.2 0 0 1 1.8 0L18 17" />
    </>,
    p,
  );

export const IconUpload = (p: IconProps) =>
  base(
    <>
      <path d="M12 15V5" />
      <path d="m8 9 4-4 4 4" />
      <path d="M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </>,
    p,
  );

export const IconBold = (p: IconProps) =>
  base(
    <>
      <path d="M7 5h6a3.2 3.2 0 0 1 0 6.4H7Z" />
      <path d="M7 11.4h7a3.3 3.3 0 0 1 0 6.6H7Z" />
    </>,
    p,
  );

export const IconItalic = (p: IconProps) =>
  base(
    <>
      <path d="M11 5h6" />
      <path d="M7 19h6" />
      <path d="M14 5 10 19" />
    </>,
    p,
  );

export const IconUnderline = (p: IconProps) =>
  base(
    <>
      <path d="M6 4v7a6 6 0 0 0 12 0V4" />
      <path d="M5 20h14" />
    </>,
    p,
  );

export const IconLink = (p: IconProps) =>
  base(
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-2 2a4 4 0 0 0 5.7 5.7l1-1" />
    </>,
    p,
  );

export const IconPrint = (p: IconProps) =>
  base(
    <>
      <path d="M7 8V4h10v4" />
      <rect x="4" y="8" width="16" height="8" rx="1.2" />
      <path d="M7 16v4h10v-4" />
    </>,
    p,
  );

export const IconAlignLeft = (p: IconProps) =>
  base(
    <>
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h13" />
    </>,
    p,
  );

export const IconAlignCenter = (p: IconProps) =>
  base(
    <>
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M5.5 18h13" />
    </>,
    p,
  );

export const IconAlignRight = (p: IconProps) =>
  base(
    <>
      <path d="M4 6h16" />
      <path d="M10 12h10" />
      <path d="M7 18h13" />
    </>,
    p,
  );

export const IconBorderNone = (p: IconProps) =>
  base(
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" strokeDasharray="2 3" opacity={0.5} />
      <path d="M5 19 19 5" />
    </>,
    p,
  );

export const IconBorderSolid = (p: IconProps) =>
  base(
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />
    </>,
    p,
  );

export const IconBorderDashed = (p: IconProps) =>
  base(
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" strokeDasharray="3 2.5" />
    </>,
    p,
  );

export const IconStackColumn = (p: IconProps) =>
  base(
    <>
      <rect x="5" y="4.5" width="14" height="6" rx="1" />
      <rect x="5" y="13.5" width="14" height="6" rx="1" />
    </>,
    p,
  );

export const IconStackRow = (p: IconProps) =>
  base(
    <>
      <rect x="4.5" y="5" width="6" height="14" rx="1" />
      <rect x="13.5" y="5" width="6" height="14" rx="1" />
    </>,
    p,
  );

export const IconVariable = (p: IconProps) =>
  base(
    <>
      <path d="M9 4.5c-2.5 0-3 1.5-3 3.5v1.3c0 1.2-.5 1.9-1.7 2.2v1c1.2.3 1.7 1 1.7 2.2V16c0 2 .5 3.5 3 3.5" />
      <path d="M15 4.5c2.5 0 3 1.5 3 3.5v1.3c0 1.2.5 1.9 1.7 2.2v1c-1.2.3-1.7 1-1.7 2.2V16c0 2-.5 3.5-3 3.5" />
    </>,
    p,
  );

export const IconEye = (p: IconProps) =>
  base(
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
    p,
  );

export const IconEyeOff = (p: IconProps) =>
  base(
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.6A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3.1 3.8" />
      <path d="M6.6 7.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5c1.1 0 2.1-.2 3-.5" />
      <path d="M9.8 10a3 3 0 0 0 4.2 4.2" />
    </>,
    p,
  );
