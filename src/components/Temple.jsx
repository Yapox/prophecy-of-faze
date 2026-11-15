export default function Temple() {
  return <svg className="temple-engraving" viewBox="0 0 440 280" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.2"><path d="M38 236H402M52 226H388V236H52ZM64 215H376V226H64ZM72 102L220 37L368 102ZM95 94L220 49L345 94ZM72 102H368V116H72ZM83 116H357V124H83ZM207 76H233M220 65V88" />
    {[100, 151, 202, 253, 304].map(x => <g key={x}><path d={`M${x} 124h30v10h-30z M${x + 5} 134h20v71h-20z M${x} 205h30v10h-30z M${x + 11} 137v65 M${x + 19} 137v65`} /></g>)}
    <path d="M32 251H408M107 258H332M153 265H287M41 174L65 149M375 156L404 182" /></g>
  </svg>;
}
