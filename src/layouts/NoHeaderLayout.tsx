import React from "react";

const NoHeaderLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="krama-ambient min-h-screen bg-background">
      {children}
    </div>
  );
};

export default NoHeaderLayout;
