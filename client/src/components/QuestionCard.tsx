import { type Question, type AnswerMap } from "@shared/schema";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface QuestionCardProps {
  question: Question;
  selectedAnswer: string | null;
  onSelectAnswer: (key: string) => void;
  showFeedback: boolean;
  disabled?: boolean;
  compact?: boolean;
}

export function QuestionCard({ 
  question, 
  selectedAnswer, 
  onSelectAnswer, 
  showFeedback,
  disabled = false,
  compact = false
}: QuestionCardProps) {
  const answers = question.answers as AnswerMap;
  const answerKeys = Object.keys(answers).sort(); // A, B, C, D...

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className={cn("mb-4", compact ? "md:mb-6" : "mb-8")}>
        <h3 className={cn(
          "font-display font-semibold leading-relaxed text-foreground",
          compact ? "text-base md:text-xl" : "text-xl md:text-2xl"
        )}>
          {question.questionText}
        </h3>
      </div>

      <div className={cn("space-y-2", compact ? "md:space-y-3" : "space-y-4")}>
        {answerKeys.map((key, index) => {
          const isSelected = selectedAnswer === key;
          const isCorrect = key === question.correctAnswer;
          const isWrongSelection = isSelected && !isCorrect;
          
          let stateStyles = "border-border hover:border-primary/50 bg-card";
          
          if (showFeedback) {
            if (isCorrect) {
              stateStyles = "border-green-500 bg-green-50/50 dark:bg-green-900/10 text-green-700 dark:text-green-300";
            } else if (isWrongSelection) {
              stateStyles = "border-red-500 bg-red-50/50 dark:bg-red-900/10 text-red-700 dark:text-red-300";
            } else {
              stateStyles = "border-border/50 opacity-50";
            }
          } else if (isSelected) {
            stateStyles = "border-primary bg-primary/5 ring-1 ring-primary";
          }

          return (
            <motion.button
              key={key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                scale: showFeedback && isCorrect ? [1, 1.02, 1] : 1,
                x: showFeedback && isWrongSelection ? [0, -4, 4, -4, 4, 0] : 0
              }}
              transition={{ 
                delay: index * 0.05,
                scale: { duration: 0.3, ease: "easeOut" },
                x: { duration: 0.4, ease: "easeInOut" }
              }}
              onClick={() => !showFeedback && !disabled && onSelectAnswer(key)}
              disabled={showFeedback || disabled}
              aria-pressed={isSelected}
              className={cn(
                "w-full text-left rounded-xl border-2 transition-all duration-200 relative group flex items-start gap-2 md:gap-4",
                compact ? "p-2.5 md:p-4" : "p-4",
                stateStyles,
                !showFeedback && "hover:shadow-md hover:-translate-y-0.5"
              )}
            >
              <span className={cn(
                "flex-shrink-0 rounded-lg flex items-center justify-center font-bold text-sm border",
                compact ? "w-6 h-6 md:w-8 md:h-8 text-xs md:text-sm" : "w-8 h-8",
                showFeedback && isCorrect ? "bg-green-500 border-green-500 text-white" :
                showFeedback && isWrongSelection ? "bg-red-500 border-red-500 text-white" :
                isSelected ? "bg-primary border-primary text-primary-foreground" :
                "bg-muted border-border text-muted-foreground group-hover:border-primary/50 group-hover:text-primary"
              )}>
                {key}
              </span>
              <span className={cn(
                "flex-grow font-medium",
                compact ? "text-sm md:text-base pt-0.5" : "pt-1"
              )}>{answers[key]}</span>
              
              <AnimatePresence>
                {showFeedback && isCorrect && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <CheckCircle2 className={cn(compact ? "w-5 h-5" : "w-6 h-6", "text-green-500")} />
                  </motion.div>
                )}
                {showFeedback && isWrongSelection && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <XCircle className={cn(compact ? "w-5 h-5" : "w-6 h-6", "text-red-500")} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
